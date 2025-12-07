# Kubernetes Apply for Backstage

A custom Backstage scaffolder action that enables server-side apply of Kubernetes manifests.

## What

This action allows you to apply any Kubernetes resource directly from Backstage templates. It uses the Kubernetes server-side apply mechanism to create or update resources in your cluster.

## Why

Use this action when you need to provision Kubernetes resources as part of your Backstage software templates. Common use cases include:

- Creating ArgoCD Applications for GitOps deployments
- Provisioning namespaces and resource quotas
- Setting up RBAC resources
- Deploying any custom Kubernetes resource as part of template scaffolding

## Installation

Add the package to your Backstage backend:

```bash
yarn add --cwd packages/backend @ruivalim/kubernetes-apply
```

Register the action in your scaffolder configuration:

```typescript
import { createRouter, createBuiltinActions } from '@backstage/plugin-scaffolder-backend';
import { kubernetesApply } from '@ruivalim/kubernetes-apply';

export default async function createPlugin(env: PluginEnvironment) {
  const builtInActions = createBuiltinActions({
    integrations: ScmIntegrations.fromConfig(env.config),
    catalogClient: new CatalogClient({ discoveryApi: env.discovery }),
    config: env.config,
    reader: env.reader,
  });

  const actions = [...builtInActions, kubernetesApply()];

  return await createRouter({
    actions,
    catalogClient: new CatalogClient({ discoveryApi: env.discovery }),
    logger: env.logger,
    config: env.config,
    database: env.database,
    reader: env.reader,
  });
}
```

## Usage

### Basic Example

Apply a manifest with inline YAML content:

```yaml
steps:
  - id: apply-namespace
    name: Create Namespace
    action: kubernetes:apply
    input:
      namespaced: false
      manifest: |
        apiVersion: v1
        kind: Namespace
        metadata:
          name: ${{ parameters.namespace }}
```

### Apply from File

Apply a manifest from a file path:

```yaml
steps:
  - id: apply-deployment
    name: Apply Deployment
    action: kubernetes:apply
    input:
      namespaced: true
      manifestFile: ./kubernetes/deployment.yaml
```

### ArgoCD Application Example

```yaml
steps:
  - id: create-argocd-app
    name: Create ArgoCD Application
    action: kubernetes:apply
    input:
      namespaced: true
      manifest: |
        apiVersion: argoproj.io/v1alpha1
        kind: Application
        metadata:
          name: ${{ parameters.name }}
          namespace: argocd
        spec:
          project: default
          source:
            repoURL: ${{ parameters.repoUrl }}
            path: manifests
            targetRevision: main
          destination:
            server: https://kubernetes.default.svc
            namespace: ${{ parameters.namespace }}
          syncPolicy:
            automated:
              selfHeal: true
              prune: true
```

## Parameters

### manifest (optional)

The YAML content of the Kubernetes manifest to apply. Use this for inline manifest definitions.

### manifestFile (optional)

Path to a file containing the Kubernetes manifest to apply. Use this when the manifest is stored in a file.

Note: Provide either `manifest` or `manifestFile`, not both.

### namespaced (required)

Boolean indicating whether the resource is namespaced or cluster-scoped.

- Set to `true` for namespaced resources (Deployment, Service, ConfigMap, etc.)
- Set to `false` for cluster-scoped resources (Namespace, ClusterRole, CustomResourceDefinition, etc.)

## Requirements

The ServiceAccount running your Backstage application must have sufficient RBAC permissions to create the resources you want to apply. Ensure your cluster configuration grants the necessary permissions.

## Supported Resources

This action supports all Kubernetes resources including:

- Core resources (v1): ConfigMap, Secret, Service, Namespace, etc.
- Apps resources (apps/v1): Deployment, StatefulSet, DaemonSet, etc.
- Custom resources: ArgoCD Applications, Crossplane Claims, etc.

The action automatically handles both core API resources (apiVersion: v1) and grouped API resources (apiVersion: apps/v1).
