// A server reduced to its startup redeploy, with crash recovery. Runs until it is killed, or until
// the test that started it is gone and its stdin with it.

process.stdin.on('end', () => { process.exit(1); });
process.stdin.resume();

const { DeploymentService } = await import('../../../src/services/deployment.service.js');

const deployed = await DeploymentService.autoDeployChannels();
process.stdout.write(deployed.ok ? 'deployed\n' : `failed: ${deployed.error.message}\n`);
