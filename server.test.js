const request = require('supertest');
const { app, hash } = require('./server');

// ============ hash() unit tests ============

describe('hash()', () => {
  it('returns deterministic output for the same input', () => {
    expect(hash('hello')).toBe(hash('hello'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hash('a')).not.toBe(hash('b'));
    expect(hash('hello')).not.toBe(hash('world'));
  });

  it('handles empty string', () => {
    expect(hash('')).toBe('0');
  });

  it('handles unicode characters', () => {
    const result = hash('こんにちは');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a hex string', () => {
    const result = hash('test');
    expect(result).toMatch(/^-?[0-9a-f]+$/);
  });
});

// ============ API endpoint tests (no SSH mocking needed) ============

describe('GET /health', () => {
  it('returns ok: true', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, api: expect.any(String) });
  });
});

describe('POST /api/send', () => {
  it('returns error when no text provided', async () => {
    const res = await request(app)
      .post('/api/send')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'No text provided' });
  });
});

describe('POST /api/key', () => {
  it('returns error when no key provided', async () => {
    const res = await request(app)
      .post('/api/key')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'No key provided' });
  });
});

describe('Static file serving', () => {
  it('serves index.html at root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>claude</title>');
  });
});
