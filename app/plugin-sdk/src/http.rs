use std::time::Duration;
use windows::Foundation::Uri;
use windows::Storage::Streams::{DataReader, InputStreamOptions, UnicodeEncoding};
use windows::Web::Http::{
    Filters::{HttpBaseProtocolFilter, HttpCacheReadBehavior, HttpCacheWriteBehavior},
    HttpClient, HttpCompletionOption, HttpMethod, HttpRequestMessage, HttpResponseMessage,
    HttpStringContent,
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

fn invalid() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32))
}

fn request(method: &str, url: &str) -> windows::core::Result<HttpRequestMessage> {
    HttpRequestMessage::Create(
        &HttpMethod::Create(&HSTRING::from(method))?,
        &Uri::CreateUri(&HSTRING::from(url))?,
    )
}

/// Reads the body as a bounded stream, including when the server omits Content-Length or uses chunked transfer
/// encoding.
async fn read_body(response: &HttpResponseMessage, limit: usize) -> windows::core::Result<Vec<u8>> {
    let reader = {
        let read = response.Content()?.ReadAsInputStreamAsync()?;
        let stream = read.await?;
        DataReader::CreateDataReader(&stream)?
    };
    reader.SetInputStreamOptions(InputStreamOptions::Partial)?;
    let mut bytes = Vec::new();
    loop {
        let length = reader
            .LoadAsync(65536)?
            .cast::<IAsyncOperation<u32>>()?
            .await? as usize;
        if length == 0 {
            return Ok(bytes);
        }
        if bytes.len() + length > limit {
            return Err(invalid());
        }
        let start = bytes.len();
        bytes.resize(start + length, 0);
        reader.ReadBytes(&mut bytes[start..])?;
    }
}

/// Fixed HTTPS endpoints only; redirects are not followed, so they never forward credentials. Bodies up to 1 MiB.
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
            let request = request(method, url)?;
            for (key, value) in headers {
                if !request
                    .Headers()?
                    .TryAppendWithoutValidation(&HSTRING::from(*key), &HSTRING::from(*value))?
                {
                    return Err(invalid());
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
            Ok(Response {
                status: response.StatusCode()?.0 as u16,
                retry_after,
                body: String::from_utf8(read_body(&response, 1024 * 1024).await?)
                    .map_err(|_| invalid())?,
            })
        })
        .await
        .map_err(|_| "HTTP request timed out")?;
    request.map_err(|_| "HTTP request failed".into())
}

/// GETs a public file of at most `limit` bytes, bypassing the local HTTP cache. Follows up to five redirects, each
/// to an absolute HTTPS URL (GitHub release assets redirect to their storage host); any final status but 200 fails.
pub async fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let fetched: windows::core::Result<Vec<u8>> =
        tokio::time::timeout(Duration::from_secs(600), async {
            let filter = HttpBaseProtocolFilter::new()?;
            filter.SetAllowAutoRedirect(false)?;
            let cache = filter.CacheControl()?;
            cache.SetReadBehavior(HttpCacheReadBehavior::NoCache)?;
            cache.SetWriteBehavior(HttpCacheWriteBehavior::NoCache)?;
            let client = HttpClient::Create(&filter)?;
            let mut url = url.to_owned();
            for _ in 0..=5 {
                if !url.starts_with("https://") {
                    return Err(invalid());
                }
                let response = client
                    .SendRequestWithOptionAsync(
                        &request("GET", &url)?,
                        HttpCompletionOption::ResponseHeadersRead,
                    )?
                    .await?;
                match response.StatusCode()?.0 {
                    200 => return read_body(&response, limit).await,
                    301 | 302 | 303 | 307 | 308 => {
                        url = response
                            .Headers()?
                            .Lookup(&HSTRING::from("Location"))?
                            .to_string();
                    }
                    _ => return Err(invalid()),
                }
            }
            Err(invalid())
        })
        .await
        .map_err(|_| "Download timed out")?;
    fetched.map_err(|_| "Download failed".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn form_does_not_inject_parameters_or_corrupt_unicode() {
        assert_eq!(super::form(&[("a&", "x=y +é")]), "a%26=x%3Dy%20%2B%C3%A9");
    }
}
