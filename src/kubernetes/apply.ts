import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import {KubeConfig, CustomObjectsApi} from '@kubernetes/client-node';
import YAML from 'yaml';
import pluralize from 'pluralize';
import * as fs from 'fs';
import * as path from 'path';

export const kubernetesApply = () => {
    return createTemplateAction<{
        manifest?: string;
        manifestFile?: string;
        namespaced: boolean;
    }>({
        id: 'kubernetes:apply',
        schema: {
            input: {
                type: 'object',
                required: ['namespaced'],
                properties: {
                    manifest: {
                        type: 'string',
                        title: 'Manifest',
                        description: 'The manifest YAML content to apply in the cluster',
                    },
                    manifestFile: {
                        type: 'string',
                        title: 'Manifest File',
                        description: 'Path to a YAML file containing the manifest to apply',
                    },
                    namespaced: {
                        type: 'boolean',
                        title: 'Namespaced',
                        description: 'Whether the API is namespaced or not',
                    },
                },
            },
        },
        async handler(ctx) {
            // Validate that exactly one of manifest or manifestFile is provided
            if (!ctx.input.manifest && !ctx.input.manifestFile) {
                throw new Error('Either manifest or manifestFile must be provided');
            }
            if (ctx.input.manifest && ctx.input.manifestFile) {
                throw new Error('Cannot provide both manifest and manifestFile, choose one');
            }

            // Read manifest content from file or use direct input
            let manifestContent: string;
            if (ctx.input.manifestFile) {
                try {
                    // Resolve the file path relative to the workspace path
                    const filePath = path.resolve(ctx.workspacePath, ctx.input.manifestFile);
                    ctx.logger.info(`Reading manifest from file: ${filePath}`);
                    ctx.logger.info(`Workspace path: ${ctx.workspacePath}`);
                    manifestContent = fs.readFileSync(filePath, 'utf8');
                    ctx.logger.info(`Successfully read manifest file (${manifestContent.length} bytes)`);
                } catch (error) {
                    throw new Error(`Failed to read manifest file ${ctx.input.manifestFile}: ${error}`);
                }
            } else {
                ctx.logger.info('Using inline manifest content');
                manifestContent = ctx.input.manifest!;
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
            if (ctx.input.namespaced && !obj.metadata?.namespace) {
                throw new Error('Namespaced resource must have metadata.namespace field');
            }

            // Parse apiVersion - handle both core APIs (v1) and grouped APIs (apps/v1)
            const apiVersionParts = obj.apiVersion.split('/');
            const group = apiVersionParts.length === 2 ? apiVersionParts[0] : '';
            const version = apiVersionParts.length === 2 ? apiVersionParts[1] : apiVersionParts[0];

            // Use proper pluralization for resource names
            const plural = pluralize(obj.kind.toLowerCase());

            ctx.logger.info(
                `Applying ${obj.kind} resource: ${obj.metadata.namespace ? `${obj.metadata.namespace}/` : ''}${obj.metadata.name}`,
                {
                    apiVersion: obj.apiVersion,
                    kind: obj.kind,
                    name: obj.metadata.name,
                    namespace: obj.metadata.namespace,
                    group,
                    version,
                    plural,
                }
            );

            const kc = new KubeConfig();
            kc.loadFromDefault();
            const client = kc.makeApiClient(CustomObjectsApi);
            // Server-side apply.
            if (ctx.input.namespaced) {
                await client.patchNamespacedCustomObject(
                    group,
                    version,
                    obj.metadata.namespace,
                    plural,
                    obj.metadata.name,
                    obj,
                    undefined,
                    'backstage',
                    true,
                    { headers: { 'Content-Type': 'application/apply-patch+yaml' } }
                ).then(
                    (resp) => {
                        ctx.logger.info(
                            `Successfully applied ${obj.kind} ${obj.metadata.namespace}/${obj.metadata.name}: HTTP ${resp.response.statusCode}`
                        );
                    },
                    (err) => {
                        ctx.logger.error(
                            `Failed to apply ${obj.kind} ${obj.metadata.namespace}/${obj.metadata.name}`,
                            {
                                kind: obj.kind,
                                namespace: obj.metadata.namespace,
                                name: obj.metadata.name,
                                statusCode: err.response?.statusCode,
                                body: err.body,
                            }
                        );
                        throw err;
                    }
                );
                return;
            }
            await client.patchClusterCustomObject(
                group,
                version,
                plural,
                obj.metadata.name,
                obj,
                undefined,
                'backstage',
                true,
                { headers: { 'Content-Type': 'application/apply-patch+yaml' } }
            ).then(
                (resp) => {
                    ctx.logger.info(
                        `Successfully applied ${obj.kind} ${obj.metadata.name}: HTTP ${resp.response.statusCode}`
                    );
                },
                (err) => {
                    ctx.logger.error(
                        `Failed to apply ${obj.kind} ${obj.metadata.name}`,
                        {
                            kind: obj.kind,
                            name: obj.metadata.name,
                            statusCode: err.response?.statusCode,
                            body: err.body,
                        }
                    );
                    throw err;
                }
            );
        },
    });
};