import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('webextension-polyfill', () => ({
  default: { storage: { sync: backend, local: backend } },
}));
vi.stubGlobal('__IS_DEV__', false);
const { storage } = await import('../src/components/storage');

beforeEach(() => {
  backend.get.mockReset().mockResolvedValue({});
  backend.set.mockReset().mockResolvedValue(undefined);
});

describe('settings storage boundary', () => {
  it.each([
    { intentions: [{ url: 123, phrase: 'test' }] },
    { fuzzyMatching: 'false' },
    { inactivityMode: 'never' },
    { inactivityTimeoutMs: 0 },
    { inactivityTimeoutMs: Infinity },
    { breathAnimationIntensity: 'extreme' },
    { debugLogging: null },
  ])(
    'rejects malformed writes without changing saved settings: %j',
    async data => {
      await expect(storage.set(data as never)).rejects.toThrow();
      expect(backend.set).not.toHaveBeenCalled();
    }
  );

  it('uses defaults for corrupt settings and retains safe incomplete drafts', async () => {
    backend.get.mockResolvedValue({
      intentions: [
        null,
        { url: 12, phrase: 'bad' },
        { id: 'draft', url: '', phrase: 'unfinished' },
      ],
      fuzzyMatching: 'false',
      inactivityTimeoutMs: -1,
      inactivityMode: 'never',
      breathAnimationIntensity: [],
      debugLogging: null,
      arbitrary: 'must not escape',
    });
    const data = await storage.get();
    expect(data.intentions).toEqual([
      { id: 'draft', url: '', phrase: 'unfinished' },
    ]);
    expect(data).toMatchObject({
      fuzzyMatching: true,
      inactivityTimeoutMs: 1800000,
      inactivityMode: 'off',
      breathAnimationIntensity: 'minimal',
      debugLogging: false,
    });
    expect(data).not.toHaveProperty('arbitrary');
  });

  it('orders writes so an older in-flight autosave cannot overwrite an import', async () => {
    let finishFirst!: () => void;
    let saved: unknown;
    backend.set
      .mockImplementationOnce(
        (value: unknown) =>
          new Promise<void>(resolve => {
            finishFirst = () => {
              saved = value;
              resolve();
            };
          })
      )
      .mockImplementation(async (value: unknown) => {
        saved = value;
      });
    const earlier = storage.set({ fuzzyMatching: false });
    await Promise.resolve();
    const later = storage.set({ fuzzyMatching: true });
    await Promise.resolve();
    finishFirst();
    await Promise.all([earlier, later]);
    expect(saved).toEqual({ fuzzyMatching: true });
  });

  it('a rejected write does not prevent subsequent saves', async () => {
    backend.set.mockRejectedValueOnce(new Error('quota'));
    await expect(storage.set({ debugLogging: true })).rejects.toThrow('quota');
    await expect(storage.set({ debugLogging: false })).resolves.toBeUndefined();
  });
});

it('gives independent readers the same usable intention identities', async () => {
  backend.get.mockResolvedValue({
    intentions: [
      { id: 'stable', url: 'example.com', phrase: 'Keep this' },
      { url: 'missing-id.example', phrase: 'No identity' },
      { id: 123, url: 'numeric-id.example', phrase: 'Bad identity' },
      { id: '', url: '', phrase: 'Empty identity' },
      {
        id: 'stable',
        url: 'duplicate.example',
        phrase: 'Conflicting identity',
      },
      { id: 'draft', url: '', phrase: 'Keep unfinished draft' },
    ],
  });
  const first = await storage.get();
  const second = await storage.get();
  expect(first.intentions).toEqual([
    { id: 'stable', url: 'example.com', phrase: 'Keep this' },
    { id: 'draft', url: '', phrase: 'Keep unfinished draft' },
  ]);
  expect(second.intentions).toEqual(first.intentions);
  // Recovery must not silently rewrite storage during a read.
  expect(backend.set).not.toHaveBeenCalled();
});
