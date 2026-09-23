import { execSync } from 'child_process';

console.log('Stopping Flight Tracking server on port 3000...');

try {
  if (process.platform === 'win32') {
    // Find PID on port 3000
    const output = execSync('netstat -ano | findstr :3000 | findstr LISTENING', { encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    const pids = new Set();
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    if (pids.size > 0) {
      for (const pid of pids) {
        console.log(`Killing process PID: ${pid}`);
        try {
          execSync(`taskkill /F /PID ${pid}`);
        } catch (e) {
          // ignore if already closed
        }
      }
      console.log('✅ Flight Tracker server stopped successfully.');
    } else {
      console.log('ℹ️ No active Flight Tracker server found running on port 3000.');
    }
  } else {
    execSync("npx kill-port 3000");
    console.log('✅ Flight Tracker server stopped.');
  }
} catch (err) {
  console.log('ℹ️ No running process was found on port 3000, or it was already stopped.');
}
