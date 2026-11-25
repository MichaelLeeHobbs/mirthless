// A server reduced to its startup redeploy, with crash recovery. Runs until it is killed.

const { DeploymentService } = await import('../../../src/services/deployment.service.js');

const deployed = await DeploymentService.autoDeployChannels();
process.stdout.write(deployed.ok ? 'deployed\n' : `failed: ${deployed.error.message}\n`);
setInterval(() => {}, 60_000);
