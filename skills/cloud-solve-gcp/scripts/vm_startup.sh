#!/bin/bash
# VM startup script (runs as root at every boot; output in serial port 1). Set the VM metadata keys
#   bucket = gs://YOUR-BUCKET   (holding gcp_run.sh, CASE.tar.gz and CASE.tar.gz.sha256)
#   case   = CASE               (optional, default "case")    ranks / iterations (optional)
# Starts gcp_run.sh once as user cfd (passwordless sudo; gcp_run.sh refuses root), so no SSH is needed.
# Later boots do nothing, so starting the VM again doesn't restart the solve. If the start fails, the VM stops.
MD=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -sf -H "Metadata-Flavor: Google" "$MD/$1"; }
B=$(meta bucket); C=$(meta case); R=$(meta ranks); I=$(meta iterations)
[ -n "$B" ] || { echo "cfdrun: no bucket metadata key"; shutdown -h +1; exit 1; }
M=/var/lib/cfdrun-started
say() { echo "cfdrun: $*"; }
if [ -e "$M" ]; then say "run already started on $(cat "$M"); log: ~cfd/cfdrun/run.log"; exit 0; fi
id cfd > /dev/null 2>&1 || useradd -m -s /bin/bash cfd
echo 'cfd ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-cfdrun
chmod 440 /etc/sudoers.d/90-cfdrun
export PATH=$PATH:/snap/bin
ok=0
for i in $(seq 120); do
  if gcloud --version > /dev/null 2>&1; then ok=1; break; fi
  if [ "$i" = 36 ]; then say "no gcloud after 3 min; installing the snap"; snap install google-cloud-cli --classic; fi
  sleep 5
done
if [ "$ok" = 1 ] && sudo -u cfd -H env PATH="$PATH" RUN_NO_TAIL=1 RUN_CASE="${C:-case}" bash -c "cd ~ && gcloud storage cp $B/gcp_run.sh . && bash gcp_run.sh $B $R $I"; then
  date '+%F %T %Z' > "$M"
  say "started: log ~cfd/cfdrun/run.log, progress $B/results/progress.txt"
else
  say "start failed (see above); stopping the VM in 1 minute"
  shutdown -h +1
fi
