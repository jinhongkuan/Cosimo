import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Derive encryption key from user's passphrase
 * The passphrase is provided by the user and never stored on the server
 */
function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(
    passphrase,
    salt,
    100000,
    32,
    'sha256'
  );
}

/**
 * Encrypt data using AES-256-GCM
 * @param {object} data - The data object to encrypt
 * @param {string} passphrase - User's passphrase (never stored on server)
 * @returns {string} - Base64 encoded encrypted string (salt:iv:authTag:ciphertext)
 */
export function encryptData(data, passphrase) {
  const jsonString = JSON.stringify(data);

  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(jsonString, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  return Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'base64')
  ]).toString('base64');
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedString - Base64 encoded encrypted string
 * @param {string} passphrase - User's passphrase (never stored on server)
 * @returns {object} - The decrypted data object
 */
export function decryptData(encryptedString, passphrase) {
  try {
    const buffer = Buffer.from(encryptedString, 'base64');

    // Extract components
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    // Don't log details - could be wrong passphrase
    throw new Error('Decryption failed - invalid passphrase or corrupted data');
  }
}

/**
 * Check if a string looks like encrypted data (base64 with proper length)
 */
export function isEncrypted(str) {
  if (typeof str !== 'string') return false;
  try {
    const buffer = Buffer.from(str, 'base64');
    // Minimum length: salt + iv + authTag + at least some data
    return buffer.length > SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 10;
  } catch {
    return false;
  }
}

/**
 * Hash passphrase to create a verification token
 * This is stored on the server to verify correct passphrase without storing it
 */
export function hashPassphrase(passphrase) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(passphrase, salt, 10000, 32, 'sha256');
  return salt.toString('hex') + ':' + hash.toString('hex');
}

/**
 * Verify passphrase against stored hash
 */
export function verifyPassphrase(passphrase, storedHash) {
  try {
    const [saltHex, hashHex] = storedHash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const hash = crypto.pbkdf2Sync(passphrase, salt, 10000, 32, 'sha256');
    return hash.toString('hex') === hashHex;
  } catch {
    return false;
  }
}
