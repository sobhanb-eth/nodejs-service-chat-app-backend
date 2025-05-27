import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Encryption Service for AES-128 message encryption
 */
export class EncryptionService {
  private algorithm = 'aes-128-cbc';
  private secretKey: string;

  constructor() {
    // Use environment variable or generate a key
    this.secretKey = process.env.ENCRYPTION_SECRET_KEY || this.generateSecretKey();
    
    if (!process.env.ENCRYPTION_SECRET_KEY) {
      console.warn('ENCRYPTION_SECRET_KEY not set in environment. Using generated key.');
      console.warn('For production, set ENCRYPTION_SECRET_KEY environment variable.');
    }
  }

  /**
   * Generate a secret key for encryption
   */
  private generateSecretKey(): string {
    return createHash('sha256')
      .update('secure-chat-encryption-key-' + Date.now())
      .digest('hex')
      .substring(0, 16); // AES-128 requires 16-byte key
  }

  /**
   * Encrypt a message
   */
  encrypt(text: string): { encrypted: string; iv: string } {
    try {
      // Generate random initialization vector
      const iv = randomBytes(16);
      
      // Ensure key is 16 bytes for AES-128
      const key = Buffer.from(this.secretKey, 'utf8').slice(0, 16);
      
      // Create cipher
      const cipher = createCipheriv(this.algorithm, key, iv);
      
      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        encrypted,
        iv: iv.toString('hex')
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  /**
   * Decrypt a message
   */
  decrypt(encryptedData: { encrypted: string; iv: string }): string {
    try {
      // Ensure key is 16 bytes for AES-128
      const key = Buffer.from(this.secretKey, 'utf8').slice(0, 16);
      
      // Convert IV from hex string to buffer
      const iv = Buffer.from(encryptedData.iv, 'hex');
      
      // Create decipher
      const decipher = createDecipheriv(this.algorithm, key, iv);
      
      // Decrypt the text
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  /**
   * Encrypt message content for storage
   */
  encryptMessage(content: string): string {
    const encrypted = this.encrypt(content);
    // Store as JSON string with both encrypted content and IV
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt message content from storage
   */
  decryptMessage(encryptedContent: string): string {
    try {
      const encryptedData = JSON.parse(encryptedContent);
      return this.decrypt(encryptedData);
    } catch (error) {
      console.error('Message decryption error:', error);
      // Return original content if decryption fails (for backward compatibility)
      return encryptedContent;
    }
  }

  /**
   * Hash sensitive data (for passwords, etc.)
   */
  hash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate secure random token
   */
  generateToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Validate if content is encrypted
   */
  isEncrypted(content: string): boolean {
    try {
      const parsed = JSON.parse(content);
      return parsed.encrypted && parsed.iv;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt file metadata
   */
  encryptFileMetadata(metadata: any): string {
    const metadataString = JSON.stringify(metadata);
    return this.encryptMessage(metadataString);
  }

  /**
   * Decrypt file metadata
   */
  decryptFileMetadata(encryptedMetadata: string): any {
    try {
      const decryptedString = this.decryptMessage(encryptedMetadata);
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('File metadata decryption error:', error);
      return null;
    }
  }

  /**
   * Create message signature for integrity verification
   */
  createMessageSignature(content: string, userId: string, timestamp: number): string {
    const data = `${content}:${userId}:${timestamp}`;
    return createHash('sha256').update(data + this.secretKey).digest('hex');
  }

  /**
   * Verify message signature
   */
  verifyMessageSignature(
    content: string, 
    userId: string, 
    timestamp: number, 
    signature: string
  ): boolean {
    const expectedSignature = this.createMessageSignature(content, userId, timestamp);
    return expectedSignature === signature;
  }

  /**
   * Encrypt user session data
   */
  encryptSessionData(sessionData: any): string {
    const sessionString = JSON.stringify(sessionData);
    return this.encryptMessage(sessionString);
  }

  /**
   * Decrypt user session data
   */
  decryptSessionData(encryptedSession: string): any {
    try {
      const decryptedString = this.decryptMessage(encryptedSession);
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('Session decryption error:', error);
      return null;
    }
  }

  /**
   * Generate encryption key for group-specific encryption
   */
  generateGroupKey(groupId: string): string {
    return createHash('sha256')
      .update(groupId + this.secretKey)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Encrypt message with group-specific key
   */
  encryptGroupMessage(content: string, groupId: string): string {
    const groupKey = this.generateGroupKey(groupId);
    const iv = randomBytes(16);
    
    // Ensure key is 16 bytes for AES-128
    const key = Buffer.from(groupKey, 'utf8').slice(0, 16);
    
    const cipher = createCipheriv(this.algorithm, key, iv);
    
    let encrypted = cipher.update(content, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      groupId
    });
  }

  /**
   * Decrypt message with group-specific key
   */
  decryptGroupMessage(encryptedContent: string, groupId: string): string {
    try {
      const encryptedData = JSON.parse(encryptedContent);
      
      // Verify group ID matches
      if (encryptedData.groupId !== groupId) {
        throw new Error('Group ID mismatch');
      }
      
      const groupKey = this.generateGroupKey(groupId);
      
      // Ensure key is 16 bytes for AES-128
      const key = Buffer.from(groupKey, 'utf8').slice(0, 16);
      
      // Convert IV from hex string to buffer
      const iv = Buffer.from(encryptedData.iv, 'hex');
      
      const decipher = createDecipheriv(this.algorithm, key, iv);
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Group message decryption error:', error);
      throw new Error('Failed to decrypt group message');
    }
  }

  /**
   * Rotate encryption key (for security)
   */
  rotateKey(): string {
    const newKey = this.generateSecretKey();
    console.log('Encryption key rotated. Update ENCRYPTION_SECRET_KEY environment variable.');
    return newKey;
  }
}
