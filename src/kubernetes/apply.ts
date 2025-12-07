import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { KubeConfig, KubernetesObjectApi } from '@kubernetes/client-node';
import YAML from 'yaml';
import * as fs from 'fs';
import * as path from 'path';

export const kubernetesApply = () => {
  return createTemplateAction({
    id: 'kubernetes:apply',
    description: 'Apply a Kubernetes manifest to the cluster',
    supportsDryRun: true,
    schema: {
      input: z =>
        z.object({
          manifest: z.string().optional().describe('The manifest YAML content to apply in the cluster'),
          manifestFile: z.string().optional().describe('Path to a YAML file containing the manifest to apply'),
          namespaced: z.boolean().describe('Whether the API is namespaced or not'),
        }),
    },
    async handler(ctx) {
      const { manifest, manifestFile, namespaced } = ctx.input;

      // Validate that exactly one of manifest or manifestFile is provided
      if (!manifest && !manifestFile) {
        throw new Error('Either manifest or manifestFile must be provided');
      }
      if (manifest && manifestFile) {
        throw new Error('Cannot provide both manifest and manifestFile, choose one');
      }

      // Read manifest content from file or use direct input
      let manifestContent: string;
      if (manifestFile) {
        try {
          const filePath = path.resolve(ctx.workspacePath, manifestFile);
          ctx.logger.info(`Reading manifest from file: ${filePath}`);
          manifestContent = fs.readFileSync(filePath, 'utf8');
          ctx.logger.info(`Successfully read manifest file (${manifestContent.length} bytes)`);
        } catch (error) {
          throw new Error(`Failed to read manifest file ${manifestFile}: ${error}`);
        }
      } else {
        ctx.logger.info('Using inline manifest content');
        manifestContent = manifest!;
      }

      const obj = YAML.parse(manifestContent);

      // Validate required Kubernetes object fields
      if (!obj.apiVersion) {
        throw new Error('Invalid manifest: missing apiVersion field');
      }
      if (!obj.kind) {
        throw new Error('Invalid manifest: missing kind field');
      }
      if (!obj.metadata?.name) {
        throw new Error('Invalid manifest: missing metadata.name field');
      }
      if (namespaced && !obj.metadata?.namespace) {
        throw new Error('Namespaced resource must have metadata.namespace field');
      }

      const resourceId = obj.metadata.namespace ? `${obj.metadata.namespace}/${obj.metadata.name}` : obj.metadata.name;

      ctx.logger.info(`Applying ${obj.kind} resource: ${resourceId}`, {
        apiVersion: obj.apiVersion,
        kind: obj.kind,
        name: obj.metadata.name,
        namespace: obj.metadata.namespace,
      });

      const kc = new KubeConfig();
      kc.loadFromDefault();
      const client = KubernetesObjectApi.makeApiClient(kc);

      // Server-side apply using KubernetesObjectApi (handles both core and custom resources)
      await client
        .patch(obj, undefined, undefined, 'backstage', true, {
          headers: { 'Content-Type': 'application/apply-patch+yaml' },
        })
        .then(
          resp => {
            ctx.logger.info(`Successfully applied ${obj.kind} ${resourceId}: HTTP ${resp.response.statusCode}`);
          },
          err => {
            ctx.logger.error(`Failed to apply ${obj.kind} ${resourceId}`, {
              kind: obj.kind,
              namespace: obj.metadata.namespace,
              name: obj.metadata.name,
              statusCode: err.response?.statusCode,
              body: err.body,
            });
            throw err;
          }
        );
    },
  });
};
