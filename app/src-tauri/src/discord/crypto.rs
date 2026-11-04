use windows::Security::Cryptography::{Core::HashAlgorithmProvider, CryptographicBuffer};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::core::HSTRING;

pub fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "Discord store too large")?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // DPAPI allocates output with LocalAlloc; release it even if decoding later fails.
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            if encrypt {
                "Could not protect Discord credentials"
            } else {
                "Could not unlock Discord credentials"
            }
        })?;
        let bytes = if output.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}

pub fn pkce() -> Result<(String, String), String> {
    let bytes =
        CryptographicBuffer::GenerateRandom(32).map_err(|_| "Could not create Discord verifier")?;
    let verifier = base64url(
        &CryptographicBuffer::EncodeToBase64String(&bytes)
            .map_err(|_| "Could not encode Discord verifier")?
            .to_string(),
    );
    let input = CryptographicBuffer::CreateFromByteArray(verifier.as_bytes())
        .map_err(|_| "Could not hash Discord verifier")?;
    let hash = HashAlgorithmProvider::OpenAlgorithm(&HSTRING::from("SHA256"))
        .and_then(|algorithm| algorithm.HashData(&input))
        .map_err(|_| "Could not hash Discord verifier")?;
    let challenge = CryptographicBuffer::EncodeToBase64String(&hash)
        .map_err(|_| "Could not encode Discord challenge")?;
    Ok((verifier, base64url(&challenge.to_string())))
}

fn base64url(value: &str) -> String {
    value
        .trim_end_matches('=')
        .replace('+', "-")
        .replace('/', "_")
}
