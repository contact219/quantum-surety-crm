"""
Deploy quantum-surety-crm to production server.
Usage: python deploy_to_server.py
"""
import paramiko
import sys

SERVER = "192.168.4.122"
USER = "tsparks"
PASSWORD = "zadoL4cu!"
DEPLOY_SCRIPT = "/usr/quantum-surety-crm/deploy.sh"

def run_deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {SERVER}...")
    ssh.connect(SERVER, username=USER, password=PASSWORD)

    print("Running deploy script...\n")
    stdin, stdout, stderr = ssh.exec_command(
        f"echo {PASSWORD} | sudo -S bash {DEPLOY_SCRIPT}",
        get_pty=True
    )

    # Stream output in real time
    for line in stdout:
        print(line, end="")

    err = stderr.read().decode().strip()
    if err and "password for" not in err:
        print(f"\nSTDERR: {err}", file=sys.stderr)

    ssh.close()
    print("\nDone.")

if __name__ == "__main__":
    run_deploy()
