#!/bin/bash
# Run manually as root from the reviewed checkout, with the CI public key path.
set -euo pipefail
[[ $EUID == 0 && $# == 1 && -f $1 ]] || { echo 'Usage: sudo bash deploy/ci/install.sh /path/to/key.pub'; exit 2; }
key=$(cat "$1")
[[ $key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ && $key != *$'\n'* ]] || exit 2
ssh-keygen -l -f "$1" >/dev/null
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
id kimia-deploy >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/kimia-deploy --shell /bin/bash kimia-deploy
test "$(getent passwd kimia-deploy | cut -d: -f6)" = /var/lib/kimia-deploy
install -d -o root -g root -m 0755 /usr/local/lib/kimia
install -o root -g root -m 0755 "$source_dir/build-release.sh" /usr/local/lib/kimia/build-release
install -o root -g root -m 0755 "$source_dir/ssh-command.sh" /usr/local/lib/kimia/ssh-command
install -o root -g root -m 0755 "$source_dir/deploy-release.sh" /usr/local/sbin/kimia-deploy
sudoers=$(mktemp)
trap 'rm -f "$sudoers"' EXIT
printf '%s\n' 'kimia-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kimia-deploy *' > "$sudoers"
visudo -cf "$sudoers"
install -o root -g root -m 0440 "$sudoers" /etc/sudoers.d/kimia-deploy
install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
printf 'restrict,command="/usr/local/lib/kimia/ssh-command" %s\n' "$key" > /etc/ssh/authorized_keys/kimia-deploy
chmod 0644 /etc/ssh/authorized_keys/kimia-deploy
cat > /etc/ssh/sshd_config.d/60-kimia-deploy.conf <<'EOF'
Match User kimia-deploy
    AuthorizedKeysFile /etc/ssh/authorized_keys/kimia-deploy
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding yes
    PermitTTY no
    PermitUserRC no
    ForceCommand /usr/local/lib/kimia/ssh-command
Match all
EOF
/usr/sbin/sshd -t
systemctl reload ssh
if [[ ! -d /var/lib/kimia-deploy/repository/.git ]]; then
  /usr/sbin/runuser -u kimia-deploy -- git clone https://github.com/amirfassadi/KimiaBeautySalon.git /var/lib/kimia-deploy/repository
fi
echo 'Restricted Kimia deploy access installed. No application release was activated.'
