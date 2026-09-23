import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { KubeConfig, KubernetesObject, KubernetesObjectApi, PatchStrategy } from '@kubernetes/client-node';
import YAML from 'yaml';
import * as fs from 'fs';

const describeResource = (obj: KubernetesObject) =>
  obj.metadata?.namespace ? `${obj.metadata.namespace}/${obj.metadata.name}` : obj.metadata?.name;

export const parseManifests = (content: string, namespaced: boolean): KubernetesObject[] => {
  const documents = YAML.parseAllDocuments(content);
  const objects: KubernetesObject[] = [];

  for (const doc of documents) {
    if (doc.errors.length > 0) {
      throw new Error(`Invalid manifest YAML: ${doc.errors[0].message}`);
    }
    const obj = doc.toJS();
    // Empty documents, e.g. a trailing `---`
    if (obj === null || obj === undefined) {
      continue;
    }

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
    objects.push(obj);
  }

  if (objects.length === 0) {
    throw new Error('Manifest does not contain any Kubernetes object');
  }
  return objects;
};

export const kubernetesApply = () => {
  return createTemplateAction({
    id: 'kubernetes:apply',
    description: 'Apply a Kubernetes manifest to the cluster',
    supportsDryRun: true,
    schema: {
      input: z =>
        z.object({
          manifest: z.string().optional().describe('The manifest YAML content to apply in the cluster. May contain several documents separated by ---'),
          manifestFile: z.string().optional().describe('Path to a YAML file containing the manifest to apply, relative to the workspace'),
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
        const filePath = resolveSafeChildPath(ctx.workspacePath, manifestFile);
        try {
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

      const objects = parseManifests(manifestContent, namespaced);

      if (ctx.isDryRun) {
        for (const obj of objects) {
          ctx.logger.info(`Dry run: would apply ${obj.kind} ${describeResource(obj)}`);
        }
        return;
      }

      const kc = new KubeConfig();
      kc.loadFromDefault();
      const client = KubernetesObjectApi.makeApiClient(kc);

      for (const obj of objects) {
        const resourceId = describeResource(obj);
        ctx.logger.info(`Applying ${obj.kind} resource: ${resourceId}`, {
          apiVersion: obj.apiVersion,
          kind: obj.kind,
          name: obj.metadata?.name,
          namespace: obj.metadata?.namespace,
        });

        try {
          // Server-side apply handles both core and custom resources
          await client.patch(obj, undefined, undefined, 'backstage', true, PatchStrategy.ServerSideApply);
          ctx.logger.info(`Successfully applied ${obj.kind} ${resourceId}`);
        } catch (err: any) {
          ctx.logger.error(`Failed to apply ${obj.kind} ${resourceId}`, {
            kind: obj.kind,
            namespace: obj.metadata?.namespace,
            name: obj.metadata?.name,
            statusCode: err.code,
            body: err.body,
          });
          throw err;
        }
      }
    },
  });
};
