/**
 * Logger class that conditionally logs based on development mode
 * Only logs when the extension is loaded via about:debugging (temporary add-on)
 */
class Logger {
  constructor() {
    this.isDevelopmentMode = null;
    this.initPromise = this.detectDevelopmentMode();
  }

  /**
   * Detect if the extension is running in development mode
   * In Firefox, temporary add-ons (loaded via about:debugging) can be detected
   * by checking if the extension ID is a temporary UUID or by other means
   */
  async detectDevelopmentMode() {
    try {
      // Method 1: Check if extension ID is a temporary UUID format
      // Temporary extensions have UUIDs like: {12345678-1234-1234-1234-123456789012}
      const manifest = browser.runtime.getManifest();
      const extensionId = browser.runtime.id;
      
      // Temporary extensions in Firefox have UUID-style IDs when loaded via about:debugging
      const isTemporaryId = /^{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}$/i.test(extensionId);
      
      // Method 2: Check if we can access certain development-only features
      let hasDevFeatures = false;
      try {
        // Try to access management API (usually available in development)
        if (browser.management) {
          const selfInfo = await browser.management.getSelf();
          hasDevFeatures = selfInfo.installType === 'development';
        }
      } catch (e) {
        // Management API might not be available, that's okay
      }

      // Method 3: Check for unpacked extension characteristics
      // Temporary extensions often don't have update URLs
      const hasUpdateUrl = manifest.update_url !== undefined;
      
      // Development mode if:
      // - Has temporary UUID-style ID, OR
      // - Management API indicates development install, OR
      // - No update URL (typical for temporary extensions)
      this.isDevelopmentMode = isTemporaryId || hasDevFeatures || !hasUpdateUrl;
      
      return this.isDevelopmentMode;
    } catch (error) {
      // If detection fails, default to false (no logging)
      console.error('Failed to detect development mode:', error);
      this.isDevelopmentMode = false;
      return false;
    }
  }

  /**
   * Ensure development mode detection is complete before logging
   */
  async ensureInitialized() {
    if (this.isDevelopmentMode === null) {
      await this.initPromise;
    }
  }

  /**
   * Log a message (only in development mode)
   */
  async log(...args) {
    await this.ensureInitialized();
    if (this.isDevelopmentMode) {
      console.log(...args);
    }
  }

  /**
   * Log an error (only in development mode)
   */
  async error(...args) {
    await this.ensureInitialized();
    if (this.isDevelopmentMode) {
      console.error(...args);
    }
  }

  /**
   * Log a warning (only in development mode)
   */
  async warn(...args) {
    await this.ensureInitialized();
    if (this.isDevelopmentMode) {
      console.warn(...args);
    }
  }

  /**
   * Log info (only in development mode)
   */
  async info(...args) {
    await this.ensureInitialized();
    if (this.isDevelopmentMode) {
      console.info(...args);
    }
  }

  /**
   * Log debug information (only in development mode)
   */
  async debug(...args) {
    await this.ensureInitialized();
    if (this.isDevelopmentMode) {
      console.debug(...args);
    }
  }

  /**
   * Get current development mode status
   */
  async isDev() {
    await this.ensureInitialized();
    return this.isDevelopmentMode;
  }

  /**
   * Synchronous logging methods (use with caution - may not work if not initialized)
   * These are provided for cases where async logging is not practical
   */
  logSync(...args) {
    if (this.isDevelopmentMode === true) {
      console.log(...args);
    }
  }

  errorSync(...args) {
    if (this.isDevelopmentMode === true) {
      console.error(...args);
    }
  }

  warnSync(...args) {
    if (this.isDevelopmentMode === true) {
      console.warn(...args);
    }
  }
}

// Create a global logger instance
const logger = new Logger();

// For backward compatibility, also expose individual functions
const devLog = (...args) => logger.log(...args);
const devError = (...args) => logger.error(...args);
const devWarn = (...args) => logger.warn(...args);
const devInfo = (...args) => logger.info(...args);
const devDebug = (...args) => logger.debug(...args);