import { LogLevel } from '@slack/bolt';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, loadEnv, readConfig } from '../lib/config.js';

const tokens = { SLACK_BOT_TOKEN: 'xoxb-dummy', SLACK_APP_TOKEN: 'xapp-dummy' };

describe('readConfig', () => {
  it('reads tokens, port and log level from the environment', () => {
    expect(readConfig({ ...tokens, PORT: '9000', LOG_LEVEL: 'debug' })).toEqual({
      ok: true,
      config: { botToken: 'xoxb-dummy', appToken: 'xapp-dummy', port: 9000, logLevel: LogLevel.DEBUG, dataDir: 'data' },
    });
  });

  it('reads the data directory, defaulting to ./data', () => {
    const custom = readConfig({ ...tokens, DATA_DIR: '/app/data' });
    expect(custom.ok && custom.config.dataDir).toBe('/app/data');
  });

  it('defaults to port 8080 and info logs', () => {
    const loaded = readConfig({ ...tokens, PORT: 'nope' });
    expect(loaded.ok && loaded.config.port).toBe(DEFAULT_PORT);
    expect(loaded.ok && loaded.config.logLevel).toBe(LogLevel.INFO);
  });

  it('turns on distribution only with client id, client secret and app secret together', () => {
    const secret = 'a'.repeat(32);
    const all = readConfig({ SLACK_APP_TOKEN: 'xapp-dummy', SLACK_CLIENT_ID: '1.2', SLACK_CLIENT_SECRET: 'cs', APP_SECRET: secret });
    expect(all.ok && all.config.distribution).toEqual({ clientId: '1.2', clientSecret: 'cs', appSecret: secret });
    expect(all.ok && all.config.botToken).toBeUndefined();
    expect(readConfig({ ...tokens, SLACK_CLIENT_ID: '1.2' })).toEqual({
      ok: false,
      missing: ['SLACK_CLIENT_SECRET', 'APP_SECRET'],
    });
    expect(readConfig({ ...tokens, SLACK_CLIENT_ID: '1.2', SLACK_CLIENT_SECRET: 'cs', APP_SECRET: 'short' })).toEqual({
      ok: false,
      missing: ['APP_SECRET (at least 32 characters)'],
    });
  });

  it('needs the bot token when the app is not distributed', () => {
    expect(readConfig({ SLACK_APP_TOKEN: 'xapp-dummy' })).toEqual({ ok: false, missing: ['SLACK_BOT_TOKEN'] });
  });

  it('names the missing secrets without echoing values', () => {
    expect(readConfig({ SLACK_BOT_TOKEN: 'xoxb-dummy', SLACK_APP_TOKEN: '  ' })).toEqual({
      ok: false,
      missing: ['SLACK_APP_TOKEN'],
    });
  });
});

describe('loadEnv', () => {
  const file = "SLACK_BOT_TOKEN='xoxb-from-file'\nSLACK_APP_TOKEN='xapp-from-file'\nPORT='9999'\n";

  it('reads quoted dotenv lines from APP_ENV_FILE', () => {
    const env = loadEnv({ APP_ENV_FILE: '/run/secrets/app.env' }, () => file);
    expect(env.SLACK_BOT_TOKEN).toBe('xoxb-from-file');
    expect(env.SLACK_APP_TOKEN).toBe('xapp-from-file');
  });

  it('lets variables set in the environment win over the file', () => {
    const env = loadEnv({ APP_ENV_FILE: '/run/secrets/app.env', PORT: '8080' }, () => file);
    expect(env.PORT).toBe('8080');
  });

  it('returns the environment untouched without APP_ENV_FILE', () => {
    const base = { SLACK_BOT_TOKEN: 'xoxb-dummy' };
    expect(loadEnv(base, () => {
      throw new Error('must not read');
    })).toBe(base);
  });

  it('fails loudly when the file cannot be read', () => {
    expect(() =>
      loadEnv({ APP_ENV_FILE: '/missing' }, () => {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      })
    ).toThrow();
  });
});
