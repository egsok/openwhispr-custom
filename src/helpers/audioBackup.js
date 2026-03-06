const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");
const debugLogger = require("./debugLogger");

const MAX_BACKUP_FILES = 50;
const FILENAME_RE = /^recording-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\w+$/;

class AudioBackupManager {
  constructor(userDataPath) {
    this.defaultDir = path.join(userDataPath, "audio-backup");
    this.maxFiles = MAX_BACKUP_FILES;
    this._customDir = null;
  }

  getBackupDir() {
    const dir = this._customDir || this.defaultDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Save audio buffer to a timestamped backup file.
   * @param {Buffer} audioBuffer
   * @param {object} [metadata] - optional metadata (language, model)
   * @returns {Promise<string>} filename (basename only)
   */
  async saveAudio(audioBuffer, metadata = {}) {
    const dir = this.getBackupDir();
    const now = new Date();
    const ts = now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
    const ext = "webm";
    const filename = `recording-${ts}.${ext}`;
    const filePath = path.join(dir, filename);

    await fsPromises.writeFile(filePath, audioBuffer);
    debugLogger.log("Audio backup saved", { filename, size: audioBuffer.length });

    return filename;
  }

  /**
   * Remove oldest files if count exceeds maxFiles.
   */
  async rotateFiles() {
    const dir = this.getBackupDir();
    let entries;
    try {
      entries = await fsPromises.readdir(dir);
    } catch {
      return;
    }

    const backupFiles = entries.filter((f) => FILENAME_RE.test(f)).sort();

    if (backupFiles.length <= this.maxFiles) return;

    const toDelete = backupFiles.slice(0, backupFiles.length - this.maxFiles);
    for (const f of toDelete) {
      try {
        await fsPromises.unlink(path.join(dir, f));
        debugLogger.log("Audio backup rotated (deleted)", { filename: f });
      } catch (err) {
        debugLogger.error("Failed to delete old backup", { filename: f, error: err.message });
      }
    }
  }

  /**
   * List all backup files with metadata.
   * @returns {Promise<Array<{filename: string, size: number, date: string}>>}
   */
  async listBackups() {
    const dir = this.getBackupDir();
    let entries;
    try {
      entries = await fsPromises.readdir(dir);
    } catch {
      return [];
    }

    const backupFiles = entries.filter((f) => FILENAME_RE.test(f)).sort().reverse();
    const results = [];

    for (const f of backupFiles) {
      try {
        const stat = await fsPromises.stat(path.join(dir, f));
        results.push({
          filename: f,
          size: stat.size,
          date: stat.mtime.toISOString(),
        });
      } catch {
        // skip files we can't stat
      }
    }

    return results;
  }

  /**
   * Read a backup file by filename.
   * @param {string} filename - must match the expected pattern (path traversal protection)
   * @returns {Promise<Buffer>}
   */
  async getBackupBuffer(filename) {
    if (!FILENAME_RE.test(filename)) {
      throw new Error("Invalid backup filename");
    }
    const filePath = path.join(this.getBackupDir(), filename);
    return fsPromises.readFile(filePath);
  }

  /**
   * Set a custom backup directory and persist via environment.
   * @param {string} newDir
   */
  setBackupDir(newDir) {
    this._customDir = newDir;
    process.env.AUDIO_BACKUP_DIR = newDir;
  }

  /**
   * Restore custom dir from env on startup.
   */
  restoreFromEnv() {
    const envDir = process.env.AUDIO_BACKUP_DIR;
    if (envDir) {
      this._customDir = envDir;
    }
  }
}

module.exports = AudioBackupManager;
