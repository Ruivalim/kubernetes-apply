import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { kubernetesApply } from './kubernetes';

export const scaffolderModuleKubernetesApply = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'kubernetes-apply',
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
