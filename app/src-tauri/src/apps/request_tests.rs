use super::model::{Request, Windows, parse_request};

#[test]
fn window_selection_defaults_and_validation_protect_the_native_boundary() {
    let parse = |extra: serde_json::Value| {
        let mut raw = serde_json::json!({ "op": "toggle", "app": "aumid:Steam" });
        raw.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value::<Request>(raw)
            .map_err(|e| e.to_string())
            .and_then(parse_request)
    };
    assert_eq!(parse(serde_json::json!({})).unwrap().windows, Windows::All);
    for bad in [
        serde_json::json!({"windows":"recent"}),
        serde_json::json!({"windows":null}),
        serde_json::json!({"windows":"title", "title":" "}),
        serde_json::json!({"windows":"window", "title":""}),
        serde_json::json!({"title":3}),
        serde_json::json!({"title":"bad\nname"}),
        serde_json::json!({"title":"x".repeat(1025)}),
        serde_json::json!({"windows":"main", "hide":"close", "force":true}),
    ] {
        assert!(parse(bad.clone()).is_err(), "{bad}");
    }
    let command = parse(serde_json::json!({"windows":"title", "title":" STEAM "})).unwrap();
    assert_eq!(command.windows, Windows::Title);
    assert_eq!(command.title, "steam");
    let command = parse(serde_json::json!({"windows":"window", "title":"Friends List"})).unwrap();
    assert_eq!(command.windows, Windows::Window);
    assert_eq!(command.title, "friends list");
}
