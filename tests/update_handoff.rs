use std::process::Command;

#[test]
fn versions_are_root_independent_and_distinguish_release_format_and_protocol() {
    let cli = env!("CARGO_BIN_EXE_mindflow");
    let short = Command::new(cli)
        .arg("-V")
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(short.status.success());
    assert_eq!(
        String::from_utf8(short.stdout).unwrap(),
        format!("mindflow {}\n", env!("CARGO_PKG_VERSION"))
    );
    let long = Command::new(cli)
        .args(["--root", "/no/such/root", "--version"])
        .output()
        .unwrap();
    assert!(long.status.success());
    assert_eq!(
        String::from_utf8(long.stdout).unwrap(),
        format!(
            "mindflow {}\nProject format: {}\nBridge protocol: {}\n",
            env!("CARGO_PKG_VERSION"),
            mindflow::project::CURRENT_FORMAT,
            mindflow::bridge::PROTOCOL_VERSION
        )
    );
    let handoff = include_str!("../src/update-handoff.md");
    assert!(handoff.contains(env!("CARGO_PKG_VERSION")));
    assert!(handoff.contains(mindflow::project::CURRENT_FORMAT));
}

#[test]
fn handoff_is_exact_root_independent_and_describes_manual_adoption() {
    let output = Command::new(env!("CARGO_BIN_EXE_mindflow"))
        .arg("update-handoff")
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        include_str!("../src/update-handoff.md")
    );
    let output = Command::new(env!("CARGO_BIN_EXE_mindflow"))
        .args(["--root", "/no/such/root", "update-handoff"])
        .output()
        .unwrap();
    assert!(!output.status.success());
}
#[test]
fn removed_migration_and_tie_aliases_are_not_commands() {
    for args in [
        vec!["migrate"],
        vec!["tie", "list"],
        vec!["evolve", "select", "--concern", "x", "--tie", "x"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_mindflow"))
            .args(args)
            .output()
            .unwrap();
        assert!(!output.status.success());
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(
            error.contains("unrecognized") || error.contains("unexpected"),
            "{error}"
        );
    }
}
