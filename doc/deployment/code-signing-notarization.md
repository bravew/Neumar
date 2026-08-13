# macOS Code Signing & Notarization Setup

Step-by-step guide to obtain and configure the macOS code signing and notarization secrets required for the GitHub Actions CI/CD pipeline.

---

## Prerequisites

- A **paid Apple Developer account** ($99/year) — [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)
- A **Mac** with Keychain Access (required for certificate creation)
- Access to your **GitHub repository settings** (admin role)

---

## Step 1: Create a Developer ID Application Certificate

This certificate is what Apple requires for apps distributed outside the Mac App Store.

1. On your Mac, open **Keychain Access** (search in Spotlight)
2. Go to **Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority**
3. Enter your email, leave **CA Email** blank, select **Saved to disk**, save the `.certSigningRequest` file
4. Go to [Apple Developer > Certificates](https://developer.apple.com/account/resources/certificates/list)
5. Click the **+** button to create a new certificate
6. Select **Developer ID Application** and click Continue
7. Upload your `.certSigningRequest` file
8. Download the generated `.cer` file
9. **Double-click** the `.cer` file to install it in your keychain (make sure the **login** keychain is selected)

> **Important:** Only the Account Holder role can create Developer ID certificates. If you're on a team, the account holder needs to do this step.

---

## Step 2: Find Your Signing Identity — `APPLE_SIGNING_IDENTITY`

After installing the certificate, run this in Terminal:

```bash
security find-identity -v -p codesigning
```

You'll see output like:

```
1) ABC123DEF456... "Developer ID Application: Your Name (TEAMID)"
```

The **quoted string** is your signing identity. Copy the entire string content:

```
Developer ID Application: Your Name (TEAMID)
```

This becomes your `APPLE_SIGNING_IDENTITY` secret.

---

## Step 3: Export Certificate as .p12 — `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`

1. Open **Keychain Access**
2. Click **My Certificates** in the left sidebar (under "login" keychain)
3. Find your **"Developer ID Application"** certificate
4. **Expand it** (click the arrow) — you should see a private key underneath
5. **Right-click the certificate** (not the private key) and select **Export**
6. Save as `.p12` format and **set a strong password** — this becomes `APPLE_CERTIFICATE_PASSWORD`
7. Convert to base64:

```bash
base64 -i certificate.p12 -o certificate-base64.txt
```

8. Open `certificate-base64.txt` — the entire content is your `APPLE_CERTIFICATE` secret

> **Security:** Delete both the `.p12` and `certificate-base64.txt` files after you've stored them as GitHub secrets. Never commit these files.

---

## Step 4: Find Your Team ID — `APPLE_TEAM_ID`

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Look under **Membership Details**
3. Your **Team ID** is a 10-character alphanumeric string (e.g., `A1B2C3D4E5`)

This becomes your `APPLE_TEAM_ID` secret.

> **Shortcut:** The Team ID also appears in your signing identity string — it's the value inside the parentheses: `Developer ID Application: Your Name (TEAMID)`.

---

## Step 5a: Set Up Notarization — App Store Connect API Key (Recommended)

App Store Connect API Keys are Apple's recommended authentication method for CI/CD. They are team-scoped (not tied to an individual), don't expire, and avoid 2FA/app-specific password issues.

1. Go to [App Store Connect > Users and Access > Integrations > Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Click **Generate API Key**
3. Name it something like `CI Notarization`
4. Select the **Developer** role (minimum required for notarization)
5. Click **Generate**
6. **Download the `.p8` key file** — you can only download it once!
7. Note the **Key ID** (e.g., `A1B2C3D4E5`) and **Issuer ID** (UUID shown at the top of the page)

This gives you three values:

| Value | GitHub Secret | Example |
|---|---|---|
| Issuer ID (UUID at top of page) | `APPLE_API_ISSUER` | `12345678-abcd-efgh-ijkl-123456789012` |
| Key ID | `APPLE_API_KEY` | `A1B2C3D4E5` |
| Contents of the `.p8` file | `APPLE_API_KEY_CONTENT` | `-----BEGIN PRIVATE KEY-----\nMIGT...` |

> **Security:** Delete the `.p8` file from disk after storing it as a GitHub secret. The key cannot be re-downloaded — if lost, revoke it and create a new one.

### Verify API key locally

```bash
xcrun notarytool history \
  --key /path/to/AuthKey.p8 \
  --key-id "A1B2C3D4E5" \
  --issuer "12345678-abcd-efgh-ijkl-123456789012"
```

---

## Step 5b: Set Up Notarization — Apple ID (Alternative / Fallback)

If you don't use an API key, the build script falls back to Apple ID + app-specific password. This method is tied to an individual's Apple ID and requires 2FA.

**`APPLE_ID`** is simply your Apple account email address.

**`APPLE_PASSWORD`** is an **app-specific password** (NOT your Apple ID password):

1. Go to [appleid.apple.com](https://appleid.apple.com/)
2. Sign in with 2FA (2FA must be enabled — it's required for app-specific passwords)
3. Go to **Sign-In and Security > App-Specific Passwords**
4. Click **Generate** (or the **+** button)
5. Name it something like `Tauri Notarization`
6. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)

This becomes your `APPLE_PASSWORD` secret.

---

## Step 6: Add All Secrets to GitHub

1. Go to your repository on GitHub
2. Navigate to **Settings > Secrets and variables > Actions**
3. Click **New repository secret** for each:

| Secret Name | Value | Example |
|---|---|---|
| `APPLE_CERTIFICATE` | Base64 content of `certificate-base64.txt` | `MIIKYgIBAzCCCi...` (very long string) |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set during .p12 export | `MyStr0ngP@ssw0rd` |
| `APPLE_SIGNING_IDENTITY` | Full identity string from Step 2 | `Developer ID Application: Your Name (A1B2C3D4E5)` |
| `APPLE_TEAM_ID` | 10-character Team ID from Step 4 | `A1B2C3D4E5` |
| `APPLE_API_ISSUER` | Issuer ID from Step 5a | `12345678-abcd-efgh-ijkl-123456789012` |
| `APPLE_API_KEY` | Key ID from Step 5a | `A1B2C3D4E5` |
| `APPLE_API_KEY_CONTENT` | Contents of the `.p8` file from Step 5a | `-----BEGIN PRIVATE KEY-----\nMIGT...` |
| `APPLE_ID` | Apple account email (fallback, Step 5b) | `you@example.com` |
| `APPLE_PASSWORD` | App-specific password (fallback, Step 5b) | `abcd-efgh-ijkl-mnop` |

---

## Step 7: Verify Locally (Optional but Recommended)

Before pushing to CI, verify your certificate works locally:

```bash
# Check certificate is installed and valid
security find-identity -v -p codesigning

# Test signing a file
codesign --force --timestamp --options runtime \
  --sign "Developer ID Application: Your Name (A1B2C3D4E5)" \
  /path/to/any/binary

# Test notarization credentials — API key (preferred)
xcrun notarytool history \
  --key /path/to/AuthKey.p8 \
  --key-id "A1B2C3D4E5" \
  --issuer "12345678-abcd-efgh-ijkl-123456789012"

# Test notarization credentials — Apple ID (fallback)
xcrun notarytool history \
  --apple-id "you@example.com" \
  --password "abcd-efgh-ijkl-mnop" \
  --team-id "A1B2C3D4E5"
```

You can also do a full local signed build:

```bash
# Set env vars — API key method (preferred)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (A1B2C3D4E5)"
export APPLE_API_ISSUER="12345678-abcd-efgh-ijkl-123456789012"
export APPLE_API_KEY="A1B2C3D4E5"
export APPLE_API_KEY_PATH="/path/to/AuthKey.p8"

# Or set env vars — Apple ID method (fallback)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (A1B2C3D4E5)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="A1B2C3D4E5"

# Build with signing (no CLI tools — smaller DMG)
pnpm build:app:mac-arm:local

# Full release build with CLI tools
pnpm build:app:mac-arm:release
```

---

## Step 8: Verify After First CI Build

After your first CI build completes, download the `.dmg` and verify:

```bash
# Check code signing
codesign --verify --deep --strict /Applications/Neumar.app

# Check notarization
spctl -a -v /Applications/Neumar.app
```

Expected output:

```
/Applications/Neumar.app: accepted
source=Notarized Developer ID
```

---

## How It Works in CI

Here's what happens when the GitHub Actions workflow runs:

1. **Certificate import** — The base64 `APPLE_CERTIFICATE` is decoded to a `.p12` file, imported into a temporary keychain with `security import`, and the partition list is set to allow `codesign` to access it without GUI prompts.

2. **Build & Sign** — The `APPLE_SIGNING_IDENTITY` env var is picked up by `build.sh`, which passes it to `codesign` for signing all binaries. When CLI tools are bundled (`--with-cli`), the script also signs native modules (`.dylib`, `.node`, Mach-O executables) in the `cli-bundle` directory, then re-signs the entire app bundle.

3. **Notarization** — The build script tries three methods in order: (a) App Store Connect API key (`APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_PATH`), (b) Apple ID (`APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`), (c) keychain profile. The script submits the app to Apple via `xcrun notarytool` for automated security analysis.

4. **Stapling** — After notarization succeeds, the notarization ticket is stapled to the app and DMG via `xcrun stapler staple`, so users can verify the app offline.

5. **Cleanup** — The temporary keychain is deleted in an `always()` step so credentials don't persist on the runner.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| "No signing identity found" | Certificate not imported correctly | Verify `APPLE_CERTIFICATE` is valid base64 and `APPLE_CERTIFICATE_PASSWORD` is correct |
| "Notarization failed: invalid credentials" | Wrong notarization password | Use an **app-specific password**, not your Apple ID password. Ensure 2FA is enabled on your Apple ID. |
| "The certificate has expired" | Developer ID certificates are valid for 5 years | Create a new certificate at [developer.apple.com](https://developer.apple.com/account/resources/certificates/list) |
| Signing hangs in CI | Keychain locked or partition list not set | The `security set-key-partition-list -S apple-tool:,apple:,codesign:` step in the workflow prevents this |
| "Resource not accessible by integration" | GitHub token lacks write permissions | Go to repo Settings > Actions > General > Workflow permissions, enable "Read and write permissions" |
| "The app is damaged and can't be opened" | App not notarized, or quarantine attribute set | Verify notarization succeeded; users can run `xattr -d com.apple.quarantine /path/to/App.app` as a workaround |
| Notarization succeeds but `spctl` rejects | Notarization ticket not stapled | Run `xcrun stapler staple /path/to/App.app` and `xcrun stapler staple /path/to/file.dmg` |

---

## Windows Code Signing (Azure Key Vault)

For Windows signing setup, the project uses [relic](https://github.com/sassoftware/relic) with Azure Key Vault. Three additional secrets are needed:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | App Registration client ID |
| `AZURE_TENANT_ID` | Azure directory tenant ID |
| `AZURE_CLIENT_SECRET` | App Registration client secret |

See the [Tauri v2 Code Signing article (Part 1)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n) for the full Azure Key Vault setup walkthrough.

---

## Tauri Updater Signing

For auto-update support, the signing keypair is checked into the repo at `src-tauri/update-key.key` (passwordless). Both CI and local builds read it directly.

To regenerate the keypair (e.g., after a key compromise):

```bash
npx tauri signer generate --ci --force -w src-tauri/update-key.key
```

Then update the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` with the contents of `src-tauri/update-key.key.pub`.

---

## Secrets Summary (15 Total)

| Category | Secrets | Status |
|---|---|---|
| macOS signing (3) | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | Required for signed macOS builds |
| macOS notarization — API key (3) | `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_CONTENT` | Recommended for notarization |
| macOS notarization — Apple ID (3) | `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD` | Fallback for notarization |
| Windows (3) | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` | Required for signed Windows builds |
| Cloudflare R2 (3) | `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY` | Required for CDN publishing |

All signing is optional — the CI workflow gracefully degrades when secrets are not configured (builds will use ad-hoc signing on macOS and skip signing on Windows). For notarization, only one method is needed (API key or Apple ID) — the build script tries API key first, then falls back to Apple ID.
