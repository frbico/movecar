"""Create MoveCar's long-lived APK signing identity once; back up secrets/ privately."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

root = Path(__file__).resolve().parent.parent
folder = root / "secrets"
folder.mkdir(mode=0o700, exist_ok=True)
bundle = folder / "movecar-release.p12"
properties = folder / "signing.properties"
if bundle.exists() or properties.exists():
    raise SystemExit("Signing files already exist; keep the original identity for upgrades.")

password = secrets.token_urlsafe(36)
key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "MoveCar Android")])
now = datetime.now(timezone.utc)
certificate = (
    x509.CertificateBuilder()
    .subject_name(name)
    .issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - timedelta(days=1))
    .not_valid_after(now + timedelta(days=365 * 50))
    .sign(key, hashes.SHA256())
)
bundle.write_bytes(
    pkcs12.serialize_key_and_certificates(
        b"movecar", key, certificate, None,
        serialization.BestAvailableEncryption(password.encode()),
    )
)
properties.write_text(
    "storeFile=movecar-release.p12\n"
    f"storePassword={password}\n"
    "keyAlias=movecar\n"
    f"keyPassword={password}\n",
    encoding="utf-8",
)
print("Signing identity created in secrets/. Back up both files privately; do not commit them.")
