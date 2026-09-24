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
yarn --cwd packages/backend add @ruivalim/kubernetes-apply
```

Then register the module in `packages/backend/src/index.ts`:

```typescript
backend.add(import('@ruivalim/kubernetes-apply'));
```

That's it, `kubernetes:apply` shows up in the list of installed actions (`/create/actions`).

### Registering the action yourself

If you already have your own scaffolder module, add the action there instead:

```typescript
import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { kubernetesApply } from '@ruivalim/kubernetes-apply';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'custom-actions',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(kubernetesApply());
      },
    });
  },
});
```

## Which cluster it talks to

The action uses the standard kubeconfig lookup of `@kubernetes/client-node`, the same one `kubectl` uses:

1. the file in the `KUBECONFIG` environment variable, if set;
2. otherwise `~/.kube/config` of the user running the backend, **with its current context**;
3. otherwise the in-cluster ServiceAccount, when the backend runs inside Kubernetes.

When you run Backstage locally, double check the current context before running a template, since it is the cluster that will receive the manifest.

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

### Several Resources at Once

A manifest can hold several documents separated by `---`. They are validated first and then applied in order:

```yaml
steps:
  - id: apply-app
    name: Create Namespace and Quota
    action: kubernetes:apply
    input:
      namespaced: false
      manifest: |
        apiVersion: v1
        kind: Namespace
        metadata:
          name: ${{ parameters.namespace }}
        ---
        apiVersion: v1
        kind: ResourceQuota
        metadata:
          name: default
          namespace: ${{ parameters.namespace }}
        spec:
          hard:
            pods: "20"
```

### Apply from File

Apply a manifest from a file in the workspace (for example one written by `fetch:template`):

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

Path to a file containing the Kubernetes manifest to apply, relative to the template workspace. Paths that point outside the workspace are rejected.

Note: Provide either `manifest` or `manifestFile`, not both.

### namespaced (required)

Boolean indicating whether the resource is namespaced or cluster-scoped.

- Set to `true` for namespaced resources (Deployment, Service, ConfigMap, etc.)
- Set to `false` for cluster-scoped resources (Namespace, ClusterRole, CustomResourceDefinition, etc.)

With `true`, every document must have `metadata.namespace`.

## Dry Run

The action supports the template editor's dry run. In a dry run the manifest is read and validated, and the log lists what would be applied, but nothing is sent to the cluster.

> Up to 0.1.x the dry run applied the manifest for real. Upgrade if you use the template editor.

## Requirements

- Backstage with the new backend system (tested on Backstage 1.55)
- Node.js 22 or 24

The ServiceAccount running your Backstage application must have sufficient RBAC permissions to create the resources you want to apply. Ensure your cluster configuration grants the necessary permissions.

## Supported Resources

This action supports all Kubernetes resources including:

- Core resources (v1): ConfigMap, Secret, Service, Namespace, etc.
- Apps resources (apps/v1): Deployment, StatefulSet, DaemonSet, etc.
- Custom resources: ArgoCD Applications, Crossplane Claims, etc.

The action automatically handles both core API resources (apiVersion: v1) and grouped API resources (apiVersion: apps/v1).

Resources are applied with server-side apply, using `backstage` as the field manager and forcing conflicts, so Backstage takes ownership of the fields it sets.

## Releasing

Releases are automated. Commits follow [Conventional Commits](https://www.conventionalcommits.org): `fix:` and `feat:` go into the next release, `feat!:` or a `BREAKING CHANGE:` footer marks a breaking one.

[release-please](https://github.com/googleapis/release-please) keeps a release PR open with the next version and changelog. Merging it tags the release and publishes it to npm with provenance, through npm trusted publishing.

Dependencies are kept up to date by [Renovate](https://docs.renovatebot.com): stable patch and minor updates merge on their own once CI passes, Backstage packages come grouped in one PR for review.
