#!/usr/bin/env bash
# One-time: generate Even's Google Play upload key and the values for the GitHub secrets.
#
#   scripts/release/android-keystore.sh [output-dir]        (default: ~/Desktop/even-upload)
#
# Writes two files into output-dir (the folder is mode 700, the files 600):
#   even-upload.keystore      the upload key: PKCS12, RSA 4096, alias even-upload, valid 100 years
#   even-upload-secrets.txt   the keystore's base64, its password, and which GitHub secret each goes into
#
# Prints file paths only, never a password or key material. It does not build or upload anything:
# Android builds and uploads happen only in .github/workflows/android.yml. See RELEASE-android.md.
set -euo pipefail

out_dir="${1:-$HOME/Desktop/even-upload}"
key_alias="even-upload"
keystore="$out_dir/even-upload.keystore"
secrets="$out_dir/even-upload-secrets.txt"
repo="appalaya/even-app"

# Find a keytool that runs. Homebrew's openjdk is keg-only, so it is never on PATH by itself, and
# macOS ships a /usr/bin/keytool stub that only offers to install Java. Try JAVA_HOME, then the
# Homebrew locations, then PATH, and keep the first one that answers.
keytool=""
for candidate in \
  "${JAVA_HOME:+$JAVA_HOME/bin/keytool}" \
  /opt/homebrew/opt/openjdk@17/bin/keytool /opt/homebrew/opt/openjdk/bin/keytool \
  /usr/local/opt/openjdk@17/bin/keytool /usr/local/opt/openjdk/bin/keytool \
  "$(command -v keytool 2>/dev/null || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]] && "$candidate" -help >/dev/null 2>&1; then
    keytool="$candidate"
    break
  fi
done
if [[ -z "$keytool" ]]; then
  echo "error: no working keytool found. Install a JDK (brew install openjdk@17) and rerun; the script finds it." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found." >&2
  exit 1
fi
if [[ -e "$keystore" || -e "$secrets" ]]; then
  echo "error: $out_dir already has an upload key. The key is made once; move the old files away first." >&2
  exit 1
fi

umask 077
mkdir -p "$out_dir"
chmod 700 "$out_dir"

# A PKCS12 keystore has one password for the store and the key (keytool ignores a different
# -keypass), so both GitHub password secrets get the same value. Passed through the
# environment so it never appears in a process list.
EVEN_KEYSTORE_PASSWORD="$(openssl rand -hex 24)"
export EVEN_KEYSTORE_PASSWORD

"$keytool" -genkeypair -v \
  -keystore "$keystore" -alias "$key_alias" \
  -keyalg RSA -keysize 4096 -validity 36500 -storetype PKCS12 \
  -dname "CN=Even upload key, O=Appalaya Inc" \
  -storepass:env EVEN_KEYSTORE_PASSWORD -keypass:env EVEN_KEYSTORE_PASSWORD >&2

keystore_b64="$(openssl base64 -A -in "$keystore")"
upload_sha256="$("$keytool" -list -v -keystore "$keystore" -alias "$key_alias" \
  -storepass:env EVEN_KEYSTORE_PASSWORD | awk '/SHA256:/ { print $2 }')"

cat > "$secrets" <<SECRETS
Even: Google Play upload key                          generated $(date '+%Y-%m-%d %H:%M %Z')

This file and even-upload.keystore are secret. Store BOTH in the password manager now, then
delete this folder. If the upload key is lost, GitHub Actions cannot publish to Google Play
until Google approves an upload key reset (Play Console > Test and release > App integrity >
App signing > Request upload key reset), which takes days. Installed apps are unaffected:
Google holds the app signing key and re-signs every release with it.

--------------------------------------------------------------------------------------------
GitHub > $repo > Settings > Secrets and variables > Actions > New repository secret.
Create each secret below with exactly this name and paste the value on the line after it.

ANDROID_UPLOAD_KEYSTORE_B64
$keystore_b64

ANDROID_UPLOAD_STORE_PASSWORD
$EVEN_KEYSTORE_PASSWORD

ANDROID_UPLOAD_KEY_ALIAS
$key_alias

ANDROID_UPLOAD_KEY_PASSWORD
$EVEN_KEYSTORE_PASSWORD
(the same value as the store password: a PKCS12 keystore has one password)

The fifth secret, PLAY_SERVICE_ACCOUNT_JSON, comes from Google Cloud; see RELEASE-android.md.

--------------------------------------------------------------------------------------------
Or with the GitHub CLI, run from this folder (nothing is echoed; paste the value when asked):

  openssl base64 -A -in even-upload.keystore | gh secret set ANDROID_UPLOAD_KEYSTORE_B64 -R $repo
  gh secret set ANDROID_UPLOAD_STORE_PASSWORD -R $repo
  gh secret set ANDROID_UPLOAD_KEY_PASSWORD -R $repo
  gh secret set ANDROID_UPLOAD_KEY_ALIAS -R $repo --body $key_alias

--------------------------------------------------------------------------------------------
Upload certificate SHA-256 (public, not a secret):
$upload_sha256

web/.well-known/assetlinks.json needs the APP SIGNING key's fingerprint from the Play Console,
not this one. Add this one as a second entry only if builds signed with the upload key itself
(never installed from Play) should open App Links.
SECRETS
chmod 600 "$keystore" "$secrets"
unset EVEN_KEYSTORE_PASSWORD keystore_b64

cat <<DONE
Wrote:
  $keystore
  $secrets

Next: open even-upload-secrets.txt, add the four ANDROID_UPLOAD_* secrets to GitHub, store both
files in your password manager, then delete $out_dir.
Keep the keystore safe: losing the upload key means asking Google for an upload key reset.
DONE
