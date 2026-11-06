use std::time::Duration;
use windows::Foundation::Uri;
use windows::Storage::Streams::{DataReader, InputStreamOptions, UnicodeEncoding};
use windows::Web::Http::{
    Filters::HttpBaseProtocolFilter, HttpClient, HttpCompletionOption, HttpMethod,
    HttpRequestMessage, HttpStringContent,
};
use windows::core::{HSTRING, Interface};
use windows_future::IAsyncOperation;

pub struct Response {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: String,
}

pub fn form(fields: &[(&str, &str)]) -> String {
    fields
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

/// Fixed HTTPS endpoints only; redirects never forward credentials. Read a bounded stream,
/// including when the server omits Content-Length or uses chunked transfer encoding.
pub async fn send(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<Response, String> {
    if !url.starts_with("https://") {
        return Err("HTTPS required".into());
    }
    let request: windows::core::Result<Response> =
        tokio::time::timeout(Duration::from_secs(10), async {
            let filter = HttpBaseProtocolFilter::new()?;
            filter.SetAllowAutoRedirect(false)?;
            let client = HttpClient::Create(&filter)?;
            let request = HttpRequestMessage::Create(
                &HttpMethod::Create(&HSTRING::from(method))?,
                &Uri::CreateUri(&HSTRING::from(url))?,
            )?;
            for (key, value) in headers {
                if !request
                    .Headers()?
                    .TryAppendWithoutValidation(&HSTRING::from(*key), &HSTRING::from(*value))?
                {
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x80070057u32 as i32,
                    )));
                }
            }
            if let Some(body) = body {
                request.SetContent(
                    &HttpStringContent::CreateFromStringWithEncodingAndMediaType(
                        &HSTRING::from(body),
                        UnicodeEncoding::Utf8,
                        &HSTRING::from("application/x-www-form-urlencoded"),
                    )?,
                )?;
            }
            let response = client
                .SendRequestWithOptionAsync(&request, HttpCompletionOption::ResponseHeadersRead)?
                .await?;
            let retry_after = response
                .Headers()?
                .Lookup(&HSTRING::from("Retry-After"))
                .ok()
                .map(|value| value.to_string());
            let reader = {
                let read = response.Content()?.ReadAsInputStreamAsync()?;
                let stream = read.await?;
                DataReader::CreateDataReader(&stream)?
            };
            reader.SetInputStreamOptions(InputStreamOptions::Partial)?;
            let mut bytes = Vec::new();
            loop {
                let length = reader
                    .LoadAsync(8192)?
                    .cast::<IAsyncOperation<u32>>()?
                    .await? as usize;
                if length == 0 {
                    break;
                }
                if bytes.len() + length > 1024 * 1024 {
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x80070057u32 as i32,
                    )));
                }
                let start = bytes.len();
                bytes.resize(start + length, 0);
                reader.ReadBytes(&mut bytes[start..])?;
            }
            Ok(Response {
                status: response.StatusCode()?.0 as u16,
                retry_after,
                body: String::from_utf8(bytes).map_err(|_| {
                    windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32))
                })?,
            })
        })
        .await
        .map_err(|_| "HTTP request timed out")?;
    request.map_err(|_| "HTTP request failed".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn form_does_not_inject_parameters_or_corrupt_unicode() {
        assert_eq!(super::form(&[("a&", "x=y +é")]), "a%26=x%3Dy%20%2B%C3%A9");
    }
}
