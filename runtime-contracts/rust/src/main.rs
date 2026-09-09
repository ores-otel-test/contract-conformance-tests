use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use serde_json::{json, Number, Value};
use std::{env, fs, process};

#[derive(Deserialize)]
struct Case { id: String, model: String, payload: String }

fn present_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where D: Deserializer<'de> {
    String::deserialize(deserializer).map(Some)
}

fn json_integer_u16<'de, D>(deserializer: D) -> Result<u16, D::Error>
where D: Deserializer<'de> {
    let number = Number::deserialize(deserializer)?;
    let value = if let Some(value) = number.as_u64() {
        value
    } else if let Some(value) = number.as_f64() {
        if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > u16::MAX as f64 {
            return Err(D::Error::custom("JSON number is not a bounded integer"));
        }
        value as u64
    } else {
        return Err(D::Error::custom("JSON number is not an unsigned integer"));
    };
    u16::try_from(value).map_err(|_| D::Error::custom("integer exceeds u16"))
}

fn codepoints(value: &str) -> usize { value.chars().count() }
fn bounded(value: &str, min: usize, max: usize) -> bool {
    let size = codepoints(value); size >= min && size <= max
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RequestMeta {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "traceId")]
    trace_id: String,
    #[serde(default, deserialize_with = "present_string", skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}
impl RequestMeta {
    fn valid(&self) -> bool {
        bounded(&self.request_id, 1, 128) && bounded(&self.trace_id, 1, 128)
            && self.locale.as_deref().map_or(true, |v| bounded(v, 2, 64))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PageQuery {
    #[serde(deserialize_with = "json_integer_u16")]
    limit: u16,
    #[serde(default, deserialize_with = "present_string", skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}
impl PageQuery {
    fn valid(&self) -> bool {
        (1..=100).contains(&self.limit)
            && self.cursor.as_deref().map_or(true, |v| bounded(v, 1, 512))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProblemDetails {
    #[serde(rename = "type")]
    problem_type: String,
    title: String,
    #[serde(deserialize_with = "json_integer_u16")]
    status: u16,
    #[serde(default, deserialize_with = "present_string", skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(rename = "requestId")]
    request_id: String,
}
impl ProblemDetails {
    fn valid(&self) -> bool {
        bounded(&self.problem_type, 1, 512) && bounded(&self.title, 1, 256)
            && (400..=599).contains(&self.status)
            && self.detail.as_deref().map_or(true, |v| bounded(v, 0, 4096))
            && bounded(&self.request_id, 1, 128)
    }
}

fn request(value: &Value) -> Option<Value> {
    let parsed: RequestMeta = serde_json::from_value(value.clone()).ok()?;
    parsed.valid().then(|| serde_json::to_value(parsed).expect("serialize request"))
}
fn page(value: &Value) -> Option<Value> {
    let parsed: PageQuery = serde_json::from_value(value.clone()).ok()?;
    parsed.valid().then(|| serde_json::to_value(parsed).expect("serialize page"))
}
fn problem(value: &Value) -> Option<Value> {
    let parsed: ProblemDetails = serde_json::from_value(value.clone()).ok()?;
    parsed.valid().then(|| serde_json::to_value(parsed).expect("serialize problem"))
}
fn public(value: &Value) -> Option<Value> {
    let mut outputs = [request(value), page(value), problem(value)].into_iter().flatten();
    let first = outputs.next()?;
    if outputs.next().is_some() { None } else { Some(first) }
}

fn semantic_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(x, y)| semantic_equal(x, y)),
        (Value::Object(a), Value::Object(b)) => a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|r| semantic_equal(v, r))),
        _ => left == right,
    }
}

fn main() {
    if let Err(error) = run() { eprintln!("rust adapter stopped: {error}"); process::exit(2); }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 { return Err("usage: rust-adapter <corpus> <output>".into()); }
    let cases: Vec<Case> = serde_json::from_str(&fs::read_to_string(&args[1])?)?;
    let mut results = Vec::with_capacity(cases.len());
    for case in cases {
        let input: Value = serde_json::from_str(&case.payload)?;
        let output = match case.model.as_str() {
            "RequestMeta" => request(&input),
            "PageQuery" => page(&input),
            "ProblemDetails" => problem(&input),
            "PublicValidationContract" => public(&input),
            _ => return Err("unknown contract model".into()),
        };
        if let Some(ref output) = output {
            if !semantic_equal(&input, output) { return Err(format!("accepted value transformed: {}", case.id).into()); }
        }
        results.push(json!({
            "caseId": case.id,
            "declaration": format!("Ores.Validation.{}", case.model),
            "verdict": if output.is_some() { "accepted" } else { "rejected" },
        }));
    }
    let runtime = env::var("RUST_RUNTIME").unwrap_or_else(|_| "rustc@unknown".into());
    let evidence = json!({
        "id": "rust-serde", "language": "rust", "runtime": runtime,
        "validator": "serde@1.0.228+serde_json@1.0.145", "toolchain": runtime,
        "status": "passed", "results": results,
    });
    fs::write(&args[2], format!("{}\n", serde_json::to_string_pretty(&evidence)?))?;
    Ok(())
}
