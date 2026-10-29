#!/usr/bin/env ruby

require "pathname"
require "yaml"

project_root = Pathname.new(__dir__).parent
skill_root = project_root.join("skills/structuralist")
entry = skill_root.join("SKILL.md")

abort "missing #{entry}" unless entry.file?

text = entry.read
match = text.match(/\A---\s*\n(.*?)\n---\s*\n/m)
abort "SKILL.md must begin with YAML frontmatter" unless match

frontmatter = YAML.safe_load(match[1], permitted_classes: [], aliases: false)
abort "skill name must be structuralist" unless frontmatter["name"] == "structuralist"
description = frontmatter["description"]
abort "skill description is missing" unless description.is_a?(String) && !description.strip.empty?

expected_references = %w[
  patterns/distinction.md
  patterns/perspective.md
  patterns/position-and-relation.md
  patterns/temporality.md
  patterns/transformation.md
  practice-realization.md
  recipe.md
].sort
reference_root = skill_root.join("references")
actual_references = reference_root.glob("**/*").select(&:file?).map do |path|
  path.relative_path_from(reference_root).to_s
end.sort
abort "unexpected reference set: #{actual_references.join(", ")}" unless actual_references == expected_references

source_named_files = skill_root.glob("**/*", File::FNM_DOTMATCH).select do |path|
  path.file? && path.binread.match?(/flow[- ]?ir/i)
end
abort "runtime package contains source-specific Flow-IR knowledge: #{source_named_files.join(", ")}" unless source_named_files.empty?

broken = []
([entry] + reference_root.glob("**/*.md")).each do |source|
  source.read.scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw|
    target = raw.split("#", 2).first
    next if target.empty? || target.match?(%r{\A(?:https?://|mailto:)})

    resolved = source.parent.join(target).cleanpath
    unless resolved.exist? && resolved.to_s.start_with?("#{skill_root}/")
      broken << "#{source.relative_path_from(skill_root)}: #{target}"
    end
  end
end
abort "broken or external package links: #{broken.join(", ")}" unless broken.empty?

metadata_path = skill_root.join("agents/openai.yaml")
metadata = YAML.safe_load(metadata_path.read, permitted_classes: [], aliases: false)
interface = metadata.fetch("interface")
short_description = interface.fetch("short_description")
abort "short_description must be 25-64 characters" unless (25..64).cover?(short_description.length)
abort "default_prompt must name $structuralist" unless interface.fetch("default_prompt").include?("$structuralist")
policy = metadata.fetch("policy")
abort "Structuralist must remain explicit-only" unless policy["allow_implicit_invocation"] == false

asset_root = skill_root.join("assets/recipe")
tokens = asset_root.glob("**/*", File::FNM_DOTMATCH).select(&:file?).flat_map do |path|
  path.read.scan(/\{\{[A-Z_]+\}\}/)
end.uniq.sort
abort "unfinished worked-example tokens: #{tokens.join(", ")}" unless tokens.empty?

puts "Structuralist skill package is structurally valid"
