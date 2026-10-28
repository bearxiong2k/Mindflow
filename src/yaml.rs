use anyhow::{bail, Result};
use serde_json::Value;

/// Enforce the deliberately small YAML surface owned by Mindflow.
pub fn validate_restricted_yaml(yaml: &str) -> Result<()> {
    let mut block_scalar_indent = None;

    for (index, raw_line) in yaml.lines().enumerate() {
        let indentation = raw_line.chars().take_while(|ch| *ch == ' ').count();
        if let Some(base_indent) = block_scalar_indent {
            if raw_line.trim().is_empty() || indentation > base_indent {
                continue;
            }
            block_scalar_indent = None;
        }

        let line = unquoted_prefix(raw_line);
        let trimmed = line.trim();

        if trimmed == "---" || trimmed == "..." {
            bail!("line {} starts another YAML document", index + 1);
        }
        if trimmed.starts_with("<<:") {
            bail!("line {} uses a YAML merge key", index + 1);
        }
        if contains_indicator(&line, '&') {
            bail!("line {} uses a YAML anchor", index + 1);
        }
        if contains_indicator(&line, '*') {
            bail!("line {} uses a YAML alias", index + 1);
        }
        if contains_indicator(&line, '!') {
            bail!("line {} uses a YAML tag", index + 1);
        }
        if starts_block_scalar(&line) {
            block_scalar_indent = Some(indentation);
        }
    }
    // Value's Mapping decoder rejects duplicate keys at every depth, unlike
    // direct BTreeMap deserialization. Also inspect quoted merge keys and tags.
    fn inspect(value: &serde_norway::Value) -> Result<()> {
        match value {
            serde_norway::Value::Mapping(map) => {
                for (key, value) in map {
                    if key.as_str() == Some("<<") {
                        bail!("YAML merge keys are unsupported");
                    }
                    inspect(key)?;
                    inspect(value)?;
                }
            }
            serde_norway::Value::Sequence(values) => {
                for value in values {
                    inspect(value)?;
                }
            }
            serde_norway::Value::Tagged(_) => bail!("YAML tags are unsupported"),
            _ => {}
        }
        Ok(())
    }
    inspect(&serde_norway::from_str::<serde_norway::Value>(yaml)?)?;
    Ok(())
}

/// Insert one block-style entry into a root mapping without rewriting any
/// unaffected source bytes.
pub fn insert_root_mapping_entry(
    yaml: &str,
    root_key: &str,
    entry_key: &str,
    entry: &str,
) -> Result<String> {
    validate_restricted_yaml(yaml)?;
    let lines = source_lines(yaml);
    let newline = line_ending(yaml);
    let entry = entry.replace('\n', newline);
    let entry = if entry.ends_with(newline) {
        entry
    } else {
        format!("{entry}{newline}")
    };

    let Some(root_index) = unique_mapping_entry(&lines, 0, root_key)? else {
        let mut updated = yaml.to_owned();
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push_str(newline);
        }
        updated.push_str(&format!("{root_key}:{newline}{entry}"));
        return Ok(updated);
    };

    let root_end = next_mapping_entry(&lines, root_index + 1, 0).unwrap_or(lines.len());
    if unique_mapping_entry_in_range(&lines, 2, entry_key, root_index + 1, root_end)?.is_some() {
        bail!("root mapping `{root_key}` already contains entry `{entry_key}`");
    }

    let root_value = mapping_entry_value(&lines[root_index], 0, root_key)?;
    if root_value.is_null() {
        let insertion = lines.get(root_end).map_or(yaml.len(), |line| line.start);
        let mut updated = String::with_capacity(yaml.len() + entry.len() + newline.len());
        updated.push_str(&yaml[..insertion]);
        if insertion > 0 && !yaml[..insertion].ends_with('\n') {
            updated.push_str(newline);
        }
        updated.push_str(&entry);
        updated.push_str(&yaml[insertion..]);
        return Ok(updated);
    }

    if root_value
        .as_object()
        .is_some_and(serde_json::Map::is_empty)
    {
        let line = &lines[root_index];
        let colon = mapping_colon(line.body)
            .ok_or_else(|| anyhow::anyhow!("cannot isolate root mapping `{root_key}`"))?;
        if line.body[colon + 1..].trim() != "{}" {
            bail!("cannot expand root mapping `{root_key}` losslessly");
        }
        let replacement = format!("{}{newline}{entry}", &line.body[..=colon]);
        return Ok(replace_range(yaml, line.start, line.end, &replacement));
    }

    bail!("root mapping `{root_key}` is not an editable block mapping")
}

/// Remove one block-style entry from a root mapping without rewriting any
/// unaffected source bytes.
pub fn remove_root_mapping_entry(yaml: &str, root_key: &str, entry_key: &str) -> Result<String> {
    validate_restricted_yaml(yaml)?;
    let lines = source_lines(yaml);
    let Some(root_index) = unique_mapping_entry(&lines, 0, root_key)? else {
        bail!("root mapping `{root_key}` does not exist");
    };
    if !mapping_entry_value(&lines[root_index], 0, root_key)?.is_null() {
        bail!("root mapping `{root_key}` is not an editable block mapping");
    }

    let root_end = next_mapping_entry(&lines, root_index + 1, 0).unwrap_or(lines.len());
    let entries = mapping_entries_in_range(&lines, 2, root_index + 1, root_end);
    let matching = entries
        .iter()
        .copied()
        .filter(|index| mapping_key(&lines[*index], 2).as_deref() == Some(entry_key))
        .collect::<Vec<_>>();
    let [entry_index] = matching.as_slice() else {
        if matching.is_empty() {
            bail!("root mapping `{root_key}` has no entry `{entry_key}`");
        }
        bail!("root mapping `{root_key}` repeats entry `{entry_key}`");
    };

    let entry_position = entries
        .iter()
        .position(|index| index == entry_index)
        .expect("matching entry came from the entry index");
    let entry_end_index = entries.get(entry_position + 1).copied().unwrap_or(root_end);
    for line in &lines[*entry_index..entry_end_index] {
        if unquoted_comment_index(line.body).is_some() {
            bail!("cannot remove `{entry_key}` losslessly because its entry contains a comment");
        }
    }

    let entry_start = lines[*entry_index].start;
    let entry_end = lines
        .get(entry_end_index)
        .map_or(yaml.len(), |line| line.start);
    if entries.len() > 1 {
        return Ok(replace_range(yaml, entry_start, entry_end, ""));
    }

    let root_line = &lines[root_index];
    let colon = mapping_colon(root_line.body)
        .ok_or_else(|| anyhow::anyhow!("cannot isolate root mapping `{root_key}`"))?;
    let tail = &root_line.body[colon + 1..];
    let comment = unquoted_comment_index(tail).map(|index| &tail[index..]);
    if comment.is_none() && !tail.trim().is_empty() {
        bail!("cannot collapse root mapping `{root_key}` losslessly");
    }
    if let Some(index) = unquoted_comment_index(tail) {
        if !tail[..index].trim().is_empty() {
            bail!("cannot collapse root mapping `{root_key}` losslessly");
        }
    }

    let newline = &yaml[root_line.body_end..root_line.end];
    let root_replacement = match comment {
        Some(comment) => format!("{} {{}} {comment}{newline}", &root_line.body[..=colon]),
        None => format!("{} {{}}{newline}", &root_line.body[..=colon]),
    };
    let mut updated = String::with_capacity(yaml.len());
    updated.push_str(&yaml[..root_line.start]);
    updated.push_str(&root_replacement);
    updated.push_str(&yaml[root_line.end..entry_start]);
    updated.push_str(&yaml[entry_end..]);
    Ok(updated)
}

/// Append one item to a block sequence nested directly under a root mapping.
/// The caller supplies an unindented YAML item beginning with `-`; this
/// function preserves every unaffected source byte and uses four-space item
/// indentation under the two-space nested key.
pub fn append_nested_sequence_item(
    yaml: &str,
    root_key: &str,
    sequence_key: &str,
    item: &str,
) -> Result<String> {
    validate_restricted_yaml(yaml)?;
    if !item.trim_start().starts_with('-') {
        bail!("nested sequence item must begin with `-`");
    }
    let lines = source_lines(yaml);
    let newline = line_ending(yaml);
    let root_index = unique_mapping_entry(&lines, 0, root_key)?
        .ok_or_else(|| anyhow::anyhow!("root mapping `{root_key}` does not exist"))?;
    if !mapping_entry_value(&lines[root_index], 0, root_key)?.is_null() {
        bail!("root mapping `{root_key}` is not an editable block mapping");
    }
    let root_end = next_mapping_entry(&lines, root_index + 1, 0).unwrap_or(lines.len());
    let nested_index =
        unique_mapping_entry_in_range(&lines, 2, sequence_key, root_index + 1, root_end)?;
    let indented = item
        .lines()
        .map(|line| format!("    {line}{newline}"))
        .collect::<String>();

    let Some(nested_index) = nested_index else {
        let insertion = lines.get(root_end).map_or(yaml.len(), |line| line.start);
        let entry = format!("  {sequence_key}:{newline}{indented}");
        let mut updated = String::with_capacity(yaml.len() + entry.len());
        updated.push_str(&yaml[..insertion]);
        updated.push_str(&entry);
        updated.push_str(&yaml[insertion..]);
        validate_restricted_yaml(&updated)?;
        return Ok(updated);
    };

    let value = mapping_entry_value(&lines[nested_index], 2, sequence_key)?;
    if value.is_null() {
        let nested_end = (nested_index + 1..root_end)
            .find(|index| mapping_key(&lines[*index], 2).is_some())
            .unwrap_or(root_end);
        let insertion = lines.get(nested_end).map_or(yaml.len(), |line| line.start);
        let mut updated = String::with_capacity(yaml.len() + indented.len());
        updated.push_str(&yaml[..insertion]);
        updated.push_str(&indented);
        updated.push_str(&yaml[insertion..]);
        validate_restricted_yaml(&updated)?;
        return Ok(updated);
    }
    if value.as_array().is_some_and(Vec::is_empty) {
        let line = &lines[nested_index];
        let colon = mapping_colon(line.body)
            .ok_or_else(|| anyhow::anyhow!("cannot isolate sequence `{sequence_key}`"))?;
        if line.body[colon + 1..].trim() != "[]" {
            bail!("cannot expand sequence `{sequence_key}` losslessly");
        }
        let replacement = format!("{}{newline}{indented}", &line.body[..=colon]);
        let updated = replace_range(yaml, line.start, line.end, &replacement);
        validate_restricted_yaml(&updated)?;
        return Ok(updated);
    }
    bail!("nested entry `{root_key}.{sequence_key}` is not an editable block sequence")
}

#[derive(Debug)]
struct SourceLine<'a> {
    start: usize,
    end: usize,
    body_end: usize,
    body: &'a str,
}

fn source_lines(source: &str) -> Vec<SourceLine<'_>> {
    let mut lines = Vec::new();
    let mut start = 0;
    for raw in source.split_inclusive('\n') {
        let end = start + raw.len();
        let without_newline = raw.strip_suffix('\n').unwrap_or(raw);
        let body = without_newline
            .strip_suffix('\r')
            .unwrap_or(without_newline);
        let body_end = start + body.len();
        lines.push(SourceLine {
            start,
            end,
            body_end,
            body,
        });
        start = end;
    }
    lines
}

fn line_ending(source: &str) -> &'static str {
    if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn unique_mapping_entry(
    lines: &[SourceLine<'_>],
    indentation: usize,
    key: &str,
) -> Result<Option<usize>> {
    unique_mapping_entry_in_range(lines, indentation, key, 0, lines.len())
}

fn unique_mapping_entry_in_range(
    lines: &[SourceLine<'_>],
    indentation: usize,
    key: &str,
    start: usize,
    end: usize,
) -> Result<Option<usize>> {
    let matching = (start..end)
        .filter(|index| mapping_key(&lines[*index], indentation).as_deref() == Some(key))
        .collect::<Vec<_>>();
    match matching.as_slice() {
        [] => Ok(None),
        [index] => Ok(Some(*index)),
        _ => bail!("mapping repeats entry `{key}`"),
    }
}

fn next_mapping_entry(lines: &[SourceLine<'_>], start: usize, indentation: usize) -> Option<usize> {
    (start..lines.len()).find(|index| mapping_key(&lines[*index], indentation).is_some())
}

fn mapping_entries_in_range(
    lines: &[SourceLine<'_>],
    indentation: usize,
    start: usize,
    end: usize,
) -> Vec<usize> {
    (start..end)
        .filter(|index| mapping_key(&lines[*index], indentation).is_some())
        .collect()
}

fn mapping_key(line: &SourceLine<'_>, indentation: usize) -> Option<String> {
    if line
        .body
        .chars()
        .take_while(|character| *character == ' ')
        .count()
        != indentation
    {
        return None;
    }
    let candidate = &line.body[indentation..];
    if candidate.trim().is_empty()
        || candidate.trim_start().starts_with('#')
        || candidate.trim_start().starts_with('-')
    {
        return None;
    }
    let value = serde_norway::from_str::<Value>(candidate).ok()?;
    let mapping = value.as_object()?;
    if mapping.len() != 1 {
        return None;
    }
    mapping.keys().next().cloned()
}

fn mapping_entry_value(
    line: &SourceLine<'_>,
    indentation: usize,
    expected_key: &str,
) -> Result<Value> {
    let candidate = &line.body[indentation..];
    let value = serde_norway::from_str::<Value>(candidate)?;
    let mapping = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("`{expected_key}` is not a mapping entry"))?;
    mapping
        .get(expected_key)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("cannot isolate mapping entry `{expected_key}`"))
}

fn mapping_colon(line: &str) -> Option<usize> {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    let characters = line.char_indices().collect::<Vec<_>>();
    for (position, (index, character)) in characters.iter().enumerate() {
        if double && escaped {
            escaped = false;
            continue;
        }
        if double && *character == '\\' {
            escaped = true;
            continue;
        }
        if !double && *character == '\'' {
            single = !single;
            continue;
        }
        if !single && *character == '"' {
            double = !double;
            continue;
        }
        if !single && !double && *character == ':' {
            let next = characters
                .get(position + 1)
                .map(|(_, character)| *character);
            if next.is_none_or(char::is_whitespace) {
                return Some(*index);
            }
        }
    }
    None
}

fn unquoted_comment_index(line: &str) -> Option<usize> {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    for (index, character) in line.char_indices() {
        if double && escaped {
            escaped = false;
            continue;
        }
        if double && character == '\\' {
            escaped = true;
            continue;
        }
        if !double && character == '\'' {
            single = !single;
            continue;
        }
        if !single && character == '"' {
            double = !double;
            continue;
        }
        if !single && !double && character == '#' {
            return Some(index);
        }
    }
    None
}

fn replace_range(source: &str, start: usize, end: usize, replacement: &str) -> String {
    let mut updated = String::with_capacity(source.len() - (end - start) + replacement.len());
    updated.push_str(&source[..start]);
    updated.push_str(replacement);
    updated.push_str(&source[end..]);
    updated
}

fn contains_indicator(line: &str, indicator: char) -> bool {
    let mut previous = None;
    for current in line.chars() {
        if current == indicator
            && previous
                .map(|c: char| c.is_whitespace() || matches!(c, ':' | '-' | '[' | '{' | ',' | '?'))
                .unwrap_or(true)
        {
            return true;
        }
        previous = Some(current);
    }
    false
}

fn starts_block_scalar(line: &str) -> bool {
    let Some(token) = line.split_whitespace().last() else {
        return false;
    };
    let mut characters = token.chars();
    matches!(characters.next(), Some('|' | '>'))
        && characters.all(|character| matches!(character, '+' | '-') || character.is_ascii_digit())
}

/// Remove comments and quoted content before checking YAML control syntax.
fn unquoted_prefix(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut single = false;
    let mut double = false;
    let mut escaped = false;

    for ch in line.chars() {
        if double && escaped {
            escaped = false;
            result.push(' ');
            continue;
        }
        if double && ch == '\\' {
            escaped = true;
            result.push(' ');
            continue;
        }
        if !double && ch == '\'' {
            single = !single;
            result.push(' ');
            continue;
        }
        if !single && ch == '"' {
            double = !double;
            result.push(' ');
            continue;
        }
        if !single && !double && ch == '#' {
            break;
        }
        result.push(if single || double { ' ' } else { ch });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_yaml_indirection_but_not_quoted_prose() {
        assert!(validate_restricted_yaml("a: &base value\n").is_err());
        assert!(validate_restricted_yaml("a: *base\n").is_err());
        assert!(validate_restricted_yaml("a: !tag value\n").is_err());
        assert!(validate_restricted_yaml("'a & b': 'x * y ! z'\n").is_ok());
    }

    #[test]
    fn rejects_document_markers_in_the_dedicated_manifest() {
        assert!(validate_restricted_yaml("---\nformat: 4\n").is_err());
        assert!(validate_restricted_yaml("format: 4\n...\n").is_err());
    }

    #[test]
    fn ignores_indicator_characters_inside_block_scalars() {
        assert!(validate_restricted_yaml(
            "description: >\n  Human prose may contain !, * and & characters.\nnext: value\n"
        )
        .is_ok());
    }

    #[test]
    fn edits_one_root_mapping_entry_without_rewriting_neighbors() {
        let original = concat!(
            "format: 7\n",
            "# retained comment\n",
            "anchors: {}\n",
            "documents: {}\n",
        );
        let entry = concat!(
            "  \"baseline\":\n",
            "    commit: 0123456789012345678901234567890123456789\n",
            "    files:\n",
            "      - \"a.md\"\n",
        );

        let inserted = insert_root_mapping_entry(original, "anchors", "baseline", entry).unwrap();
        assert!(inserted.contains("# retained comment\n"));
        assert!(inserted.contains("  \"baseline\":\n"));
        assert!(inserted.ends_with("documents: {}\n"));

        let removed = remove_root_mapping_entry(&inserted, "anchors", "baseline").unwrap();
        assert_eq!(removed, original);
    }

    #[test]
    fn refuses_to_remove_an_entry_with_comments_it_cannot_own_safely() {
        let source = concat!(
            "anchors:\n",
            "  baseline:\n",
            "    # keep this explanation\n",
            "    commit: 0123456789012345678901234567890123456789\n",
            "    files: [a.md]\n",
        );

        assert!(remove_root_mapping_entry(source, "anchors", "baseline").is_err());
        assert!(source.contains("# keep this explanation"));
    }

    #[test]
    fn appends_nested_sequence_items_without_rewriting_neighbors() {
        let original = concat!(
            "format: 17\r\n",
            "# retained comment\r\n",
            "opening:\r\n",
            "  files: []\r\n",
            "evolve:\r\n",
            "  events:\r\n",
            "    - component: parent\r\n",
            "anchors: {}\r\n",
        );
        let files = append_nested_sequence_item(original, "opening", "files", "- branch").unwrap();
        assert!(files.contains("  files:\r\n    - branch\r\n"));
        assert!(files.contains("# retained comment\r\n"));
        assert!(files.ends_with("anchors: {}\r\n"));

        let events = append_nested_sequence_item(
            &files,
            "evolve",
            "events",
            "- component: summary\n  children: [parent, branch]",
        )
        .unwrap();
        assert!(events.contains(
            "    - component: summary\r\n      children: [parent, branch]\r\n"
        ));
        assert_eq!(
            serde_norway::from_str::<Value>(&events).unwrap()["opening"]["files"][0],
            "branch"
        );
    }
}
