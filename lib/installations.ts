import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Installation, InstallationQuery, InstallationStore } from '@slack/oauth';

interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/**
 * Every workspace's installation (its bot token and ids), kept in one file under the data
 * directory and encrypted with AES-256-GCM, so the file alone gives nothing away. Writes go to a
 * temporary file that then replaces the old one, one at a time.
 */
export class FileInstallationStore implements InstallationStore {
  private readonly installations = new Map<string, Installation>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly key: Buffer,
    private readonly warn: (message: string) => void = () => {}
  ) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return;
    }
    // A file that cannot be opened with this key is never overwritten: every token in it would be lost.
    const stored = JSON.parse(this.open(JSON.parse(raw) as Sealed)) as Record<string, Installation>;
    for (const [id, installation] of Object.entries(stored)) this.installations.set(id, installation);
  }

  static inDirectory(dir: string, key: Buffer, warn?: (message: string) => void): FileInstallationStore {
    return new FileInstallationStore(join(dir, 'installations.json'), key, warn);
  }

  get size(): number {
    return this.installations.size;
  }

  async storeInstallation(installation: Installation): Promise<void> {
    this.installations.set(installationId(installation), installation);
    await this.save();
  }

  async fetchInstallation(query: InstallationQuery<boolean>): Promise<Installation> {
    const installation = this.installations.get(queryId(query));
    if (!installation) throw new Error(`No installation for ${queryId(query)}`);
    return installation;
  }

  async deleteInstallation(query: InstallationQuery<boolean>): Promise<void> {
    if (this.installations.delete(queryId(query))) await this.save();
  }

  private save(): Promise<void> {
    this.writing = this.writing.then(() => {
      const sealed = this.seal(JSON.stringify(Object.fromEntries(this.installations)));
      if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(sealed)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
    });
    return this.writing.catch((err) => {
      this.warn(`Cannot save installations: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
      throw err;
    });
  }

  private seal(plain: string): Sealed {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  private open(sealed: Sealed): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  }
}

function installationId(installation: Installation): string {
  if (installation.isEnterpriseInstall && installation.enterprise) return `E:${installation.enterprise.id}`;
  return `T:${installation.team?.id ?? ''}`;
}

function queryId(query: InstallationQuery<boolean>): string {
  return query.isEnterpriseInstall && query.enterpriseId ? `E:${query.enterpriseId}` : `T:${query.teamId ?? ''}`;
}
