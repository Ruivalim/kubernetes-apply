import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { JsonObject } from '@backstage/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockPatch = jest.fn();
const mockLoadFromDefault = jest.fn();

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({ loadFromDefault: mockLoadFromDefault })),
  KubernetesObjectApi: { makeApiClient: () => ({ patch: mockPatch }) },
  PatchStrategy: { ServerSideApply: 'application/apply-patch+yaml' },
}));

import { kubernetesApply } from './apply';

const configMap = (name: string) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}
  namespace: default
data:
  key: value
`;

describe('kubernetes:apply', () => {
  const action = kubernetesApply();
  let workspacePath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPatch.mockResolvedValue({});
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'kubernetes-apply-'));
  });

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  // createMockActionContext drops isDryRun, so it is set on the context afterwards
  const run = (input: JsonObject, isDryRun = false) =>
    action.handler({ ...createMockActionContext({ input, workspacePath }), isDryRun } as any);

  it('applies an inline manifest with server-side apply', async () => {
    await run({ manifest: configMap('a'), namespaced: true });

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'a' }) }),
      undefined,
      undefined,
      'backstage',
      true,
      'application/apply-patch+yaml',
    );
  });

  it('does not touch the cluster on dry run', async () => {
    await run({ manifest: configMap('a'), namespaced: true }, true);

    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockLoadFromDefault).not.toHaveBeenCalled();
  });

  it('still validates the manifest on dry run', async () => {
    await expect(run({ manifest: 'apiVersion: v1\nkind: ConfigMap\n', namespaced: false }, true)).rejects.toThrow(
      'missing metadata.name',
    );
  });

  it('applies every document of a multi-document manifest in order', async () => {
    await run({ manifest: `${configMap('a')}---\n${configMap('b')}---\n`, namespaced: true });

    expect(mockPatch.mock.calls.map(call => call[0].metadata.name)).toEqual(['a', 'b']);
  });

  it('validates every document before applying any', async () => {
    const manifest = `${configMap('a')}---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: b\n`;

    await expect(run({ manifest, namespaced: true })).rejects.toThrow('must have metadata.namespace');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('reads the manifest from a file relative to the workspace', async () => {
    fs.mkdirSync(path.join(workspacePath, 'k8s'));
    fs.writeFileSync(path.join(workspacePath, 'k8s', 'cm.yaml'), configMap('from-file'));

    await run({ manifestFile: './k8s/cm.yaml', namespaced: true });

    expect(mockPatch.mock.calls[0][0].metadata.name).toBe('from-file');
  });

  it('refuses a manifest file outside the workspace', async () => {
    await expect(run({ manifestFile: '../../etc/passwd', namespaced: false })).rejects.toThrow(
      /outside of the base path|not allowed/i,
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('requires exactly one of manifest and manifestFile', async () => {
    await expect(run({ namespaced: true })).rejects.toThrow('Either manifest or manifestFile');
    await expect(run({ manifest: configMap('a'), manifestFile: 'x.yaml', namespaced: true })).rejects.toThrow(
      'Cannot provide both',
    );
  });

  it('rejects invalid YAML', async () => {
    await expect(run({ manifest: 'kind: [unclosed', namespaced: false })).rejects.toThrow('Invalid manifest YAML');
  });

  it('rejects a manifest without any object', async () => {
    await expect(run({ manifest: '---\n', namespaced: false })).rejects.toThrow('does not contain any');
  });

  it('propagates API errors and stops at the first failure', async () => {
    mockPatch.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 403 }));

    await expect(run({ manifest: `${configMap('a')}---\n${configMap('b')}`, namespaced: true })).rejects.toThrow(
      'forbidden',
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});
