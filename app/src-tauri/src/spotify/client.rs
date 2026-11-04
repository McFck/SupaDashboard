use super::{
    Command, Message, Operation, SpotifyHub, api, auth, shuffle,
    store::{Credentials, Store},
};
use crate::http;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

struct Client {
    app: AppHandle,
    generation: u64,
    store: Store,
    player: api::Player,
    liked: Option<bool>,
    retry_at: Option<Instant>,
}

pub(super) async fn run(
    app: AppHandle,
    generation: u64,
    path: PathBuf,
    mut receiver: mpsc::Receiver<Message>,
) {
    let store = match Store::open(path) {
        Ok(store) => store,
        Err(error) => {
            app.state::<SpotifyHub>().publish(
                &app,
                generation,
                json!({"state":"needsAuth", "error":error}),
            );
            while let Some(message) = receiver.recv().await {
                let _ = message
                    .reply
                    .send(Err("Could not read Spotify store".into()));
            }
            return;
        }
    };
    let mut client = Client {
        app,
        generation,
        store,
        player: api::Player::default(),
        liked: None,
        retry_at: None,
    };
    loop {
        let error = client.poll().await.err();
        client.publish(error);
        let delay = if client.player.playing { 5 } else { 30 };
        match tokio::time::timeout(Duration::from_secs(delay), receiver.recv()).await {
            Ok(Some(message)) => {
                let result = client.operation(message.operation).await;
                client.publish(None);
                let _ = message.reply.send(result);
            }
            Ok(None) => break,
            Err(_) => {}
        }
    }
}

impl Client {
    fn publish(&self, error: Option<String>) {
        let view: Value = if self.store.credentials.tokens.is_some() {
            json!({"state":"ready", "user":self.store.credentials.user_name, "trackUri":self.player.uri, "liked":self.liked, "smartShuffle":self.player.smart_shuffle, "shuffle":self.player.shuffle, "error":error})
        } else {
            json!({"state":"needsAuth", "error":error})
        };
        self.app
            .state::<SpotifyHub>()
            .publish(&self.app, self.generation, view);
    }

    async fn refresh(&mut self) -> Result<(), String> {
        let credentials = &self.store.credentials;
        let result = auth::refresh(
            &credentials.client_id,
            credentials.tokens.as_ref().ok_or("Connect Spotify first")?,
        )
        .await;
        match result {
            Ok(tokens) => self.store.save(Credentials {
                tokens: Some(tokens),
                ..credentials.clone()
            }),
            Err(error) => {
                if error == "Connect Spotify first" {
                    self.store.logout()?;
                }
                Err(error)
            }
        }
    }

    async fn request(&mut self, method: &str, path: &str) -> Result<http::Response, String> {
        if self.retry_at.is_some_and(|at| Instant::now() < at) {
            return Err("Spotify rate limited".into());
        }
        let tokens = self
            .store
            .credentials
            .tokens
            .as_ref()
            .ok_or("Connect Spotify first")?;
        if tokens.expires_at <= auth::now().saturating_add(60) {
            self.refresh().await?;
        }
        for attempt in 0..2 {
            let tokens = self
                .store
                .credentials
                .tokens
                .as_ref()
                .ok_or("Connect Spotify first")?;
            let authorization = format!("Bearer {}", tokens.access_token);
            let response = http::send(
                method,
                &format!("https://api.spotify.com/v1{path}"),
                &[("Authorization", &authorization)],
                None,
            )
            .await?;
            match api::check(&response) {
                Ok(()) => return Ok(response),
                Err(api::Error::Unauthorized) if attempt == 0 => self.refresh().await?,
                Err(error) => {
                    match error {
                        api::Error::Unauthorized => self.store.logout()?,
                        api::Error::RateLimited(seconds) => {
                            self.retry_at = Instant::now().checked_add(Duration::from_secs(seconds))
                        }
                        _ => {}
                    }
                    return Err(error.message().into());
                }
            }
        }
        Err("Connect Spotify first".into())
    }

    async fn poll(&mut self) -> Result<(), String> {
        if self.store.credentials.tokens.is_none() {
            return Ok(());
        }
        let response = self.request("GET", "/me/player").await?;
        self.player = if response.status == 204 {
            api::Player::default()
        } else {
            api::player(&response.body)?
        };
        self.liked = None;
        if let Some(uri) = &self.player.uri {
            let path = format!("/me/library/contains?{}", http::form(&[("uris", uri)]));
            self.liked = Some(api::contains(&self.request("GET", &path).await?.body)?);
        }
        Ok(())
    }

    async fn operation(&mut self, operation: Operation) -> Result<(), String> {
        match operation {
            Operation::Authorize(id) => {
                self.app.state::<SpotifyHub>().publish(
                    &self.app,
                    self.generation,
                    json!({"state":"connecting"}),
                );
                let tokens = auth::authorize(&self.app, &id).await?;
                let response = http::send(
                    "GET",
                    "https://api.spotify.com/v1/me",
                    &[("Authorization", &format!("Bearer {}", tokens.access_token))],
                    None,
                )
                .await?;
                api::check(&response).map_err(|e| e.message())?;
                let user_name = api::user(&response.body)?;
                self.store.save(Credentials {
                    client_id: id,
                    tokens: Some(tokens),
                    user_name,
                })?;
                self.retry_at = None;
                Ok(())
            }
            Operation::Logout => {
                self.store.logout()?;
                self.player = api::Player::default();
                self.liked = None;
                Ok(())
            }
            Operation::Command(command) => self.command(command).await,
            Operation::Shuffle(mode) => {
                let result = self.shuffle(mode).await;
                if let Err(error) = &result {
                    log::warn!("Spotify shuffle failed: {error}");
                }
                result
            }
        }
    }

    async fn shuffle(&mut self, mode: shuffle::Mode) -> Result<(), String> {
        // A fresh Web API read also handles GSMTC lag after an earlier fallback, and smart -> off.
        let current = if self.store.credentials.tokens.is_some() {
            match self.request("GET", "/me/player").await {
                Ok(response) if response.status != 204 => Some(api::shuffle(&response.body)?),
                // Native playback remains usable if the account or Web API is unavailable.
                _ => None,
            }
        } else {
            None
        };
        let enabled = match shuffle::native(mode, current, &self.app.state()).await? {
            shuffle::Outcome::Applied { enabled } => {
                if self.store.credentials.tokens.is_none() {
                    return Ok(());
                }
                let response = self.request("GET", "/me/player").await?;
                if response.status != 204 && api::shuffle(&response.body)? == enabled {
                    self.player.shuffle = enabled;
                    self.player.smart_shuffle = false;
                    return Ok(());
                }
                log::warn!("Spotify Web API did not confirm GSMTC shuffle; using Web API write");
                enabled
            }
            shuffle::Outcome::Fallback { enabled, error } => {
                if self.store.credentials.tokens.is_none() {
                    return Err(error);
                }
                log::warn!("{error}; using Spotify Web API shuffle");
                enabled
            }
        };
        // Preserve the original target: retrying Toggle could undo a partly applied write.
        self.request("PUT", &format!("/me/player/shuffle?state={enabled}"))
            .await?;
        self.player.smart_shuffle = false;
        self.player.shuffle = enabled;
        Ok(())
    }

    async fn command(&mut self, command: Command) -> Result<(), String> {
        let response = self.request("GET", "/me/player/currently-playing").await?;
        if response.status == 204 {
            return Err("Spotify isn't playing".into());
        }
        let uri = api::player(&response.body)?
            .uri
            .ok_or("Spotify isn't playing")?;
        let path = format!("/me/library?{}", http::form(&[("uris", &uri)]));
        let method = if matches!(command, Command::Like) {
            "PUT"
        } else {
            "DELETE"
        };
        self.request(method, &path).await?;
        self.player.uri = Some(uri);
        self.liked = Some(matches!(command, Command::Like));
        if matches!(command, Command::Dislike) {
            let sent = crate::media::media_command(
                Some("spotify".into()),
                "next".into(),
                None,
                self.app.state(),
            )
            .await?;
            if !sent {
                return Err("Spotify isn't playing".into());
            }
        }
        Ok(())
    }
}
