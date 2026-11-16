#!/bin/bash
# Solve an OpenFOAM case on a Google Cloud VM, start to finish:
#   install OpenFOAM 14 (openfoam.org) -> fetch CASE.tar.gz (+ CASE.tar.gz.sha256) from your bucket and check it ->
#   ./Allrun RANKS [ITERATIONS] -> join the last saved iteration -> put the results in the bucket -> stop the VM.
# The tarball must unpack to a folder CASE/ whose Allrun takes the rank count and, optionally, the iteration count.
#
#   bash gcp_run.sh gs://YOUR-BUCKET [ranks] [iterations] [--no-stop]   (case name: RUN_CASE, default "case")
#
#   ranks       default: the VM's physical cores (half its vCPUs on N2 machines)
#   iterations  default: whatever the case's controlDict says; use a multiple of its writeInterval
#   --no-stop   leave the VM running at the end (default: it stops itself, so CPU billing stops)
#
# It keeps going in the background: closing the SSH window doesn't stop it.
#   Watch it:   tail -f ~/cfdrun/run.log
#   Progress:   gs://YOUR-BUCKET/results/progress.txt, updated every 10 minutes
# Running it again goes on from the latest save, e.g. after a stop: bash gcp_run.sh gs://YOUR-BUCKET 8 2000
# Needs a VM with enough memory (about 2 GB per million cells to solve, more for decomposePar) and the
# Storage read-write access scope. See the cloud-solve-gcp skill (SKILL.md) for the whole procedure.
# Test hooks: RUN_WORK (work folder), RUN_MIN_RAM_GB, RUN_NO_TAIL=1, RUN_FOREGROUND=1.

usage="usage: bash gcp_run.sh gs://YOUR-BUCKET [ranks] [iterations] [--no-stop]   (case name: RUN_CASE, default 'case')"
SRC=${1:?$usage}
shift
SRC=${SRC%/}
RANKS='' ITERS='' STOP=1
ARGS=("$@")
for a in "$@"; do
    case "$a" in
        --no-stop) STOP=0 ;;
        ''|*[!0-9]*) echo "unknown argument '$a'"; echo "$usage"; exit 1 ;;
        *) if [ -z "$RANKS" ]; then RANKS=$a
           elif [ -z "$ITERS" ]; then ITERS=$a
           else echo "$usage"; exit 1; fi ;;
    esac
done
[ "$(id -u)" -ne 0 ] || { echo "Run it as your normal user, without sudo (mpirun refuses to run as root)."; exit 1; }
WORK=${RUN_WORK:-$HOME/cfdrun}
NAME=${RUN_CASE:-case}
CASE=$WORK/$NAME
LOG=$WORK/run.log
OUT=$SRC/results
mkdir -p "$WORK" || exit 1
SELF=$(readlink -f "$0")

# ---------------------------------------------------------------- start it in the background, show the log
if [ -z "$RUN_BACKGROUND" ] && [ -z "$RUN_FOREGROUND" ]; then
    if ! flock -n "$WORK/.lock" true; then
        echo "A run is already going. Watch it with: tail -f $LOG"
        exit 1
    fi
    RUN_BACKGROUND=1 setsid nohup bash "$SELF" "$SRC" "${ARGS[@]}" > /dev/null 2>&1 < /dev/null &
    for _ in $(seq 60); do   # wait (up to 30 s) until the background run holds the lock
        flock -n "$WORK/.lock" true || break
        sleep 0.5
    done
    echo "Started in the background: it keeps going if you close this window."
    echo "Log: $LOG   (Ctrl+C stops watching, not the run)"
    [ -n "$RUN_NO_TAIL" ] && exit 0
    sleep 2
    exec tail -n +1 -f "$LOG"
fi

# ---------------------------------------------------------------- the run itself
exec 9> "$WORK/.lock"   # held while this runs; children get 9>&- so a leftover child can't keep it
flock -w 30 9 || { echo "another run holds $WORK/.lock"; exit 1; }
if [ -n "$RUN_FOREGROUND" ]; then
    exec > >(tee -a "$LOG") 2>&1
else
    exec >> "$LOG" 2>&1
fi

say() { echo "[$(date '+%F %T')] $*"; }

put() {   # copy a file into $OUT (the bucket's results folder; a local folder in tests)
    case "$OUT" in
        gs://*) gcloud storage cp "$1" "$OUT/" ;;
        *) mkdir -p "$OUT" && cp "$1" "$OUT/" ;;
    esac
}

get() {   # copy $SRC/<name> into the current folder
    case "$SRC" in
        gs://*) gcloud storage cp "$SRC/$1" . ;;
        *) cp "$SRC/$1" . ;;
    esac
}

progress() {   # a short status file: state, iteration, forces, the end of the solver log
    {
        echo "$NAME on $(hostname), updated $(date '+%F %T %Z')"
        echo "state: $1"
        if [ -f "$CASE/log.foamRun" ]; then
            echo "last iteration: $(grep '^Time = ' "$CASE/log.foamRun" | tail -1 | cut -d' ' -f3 | sed 's/s$//')"
        fi
        if [ -d "$CASE/postProcessing/forcesTotal" ]; then
            python3 - "$CASE/postProcessing/forcesTotal" << 'PY'
import glob, os, re, sys
rows = {}
dirs = sorted(glob.glob(os.path.join(sys.argv[1], '*')), key=lambda d: float(os.path.basename(d)))
for d in dirs:                      # one folder per start time; a restart adds a new one
    for f in glob.glob(os.path.join(d, 'forces*.dat')):
        for line in open(f):
            if line.startswith('#'):
                continue
            v = [float(x) for x in re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', line)]
            if len(v) >= 7:         # time, pressure (x y z), viscous (x y z), ...
                rows[v[0]] = (-(v[1] + v[4]), -(v[3] + v[6]))   # drag, downforce in N
t = sorted(rows)
if t:
    d, l = rows[t[-1]]
    print('forces at iteration %d: drag %.1f N, downforce %.1f N' % (t[-1], d, l))
    if len(t) >= 200:
        a = [rows[k] for k in t[-100:]]
        b = [rows[k] for k in t[-200:-100]]
        md, ml = sum(r[0] for r in a) / 100, sum(r[1] for r in a) / 100
        pd, pl = sum(r[0] for r in b) / 100, sum(r[1] for r in b) / 100
        print('mean of the last 100 iterations: drag %.1f N, downforce %.1f N'
              ' (change on the 100 before: %+.1f%% drag, %+.1f%% downforce)'
              % (md, ml, 100 * (md - pd) / pd, 100 * (ml - pl) / pl))
PY
        fi
        if [ -f "$CASE/log.foamRun" ]; then
            echo "--- end of log.foamRun"
            tail -n 12 "$CASE/log.foamRun"
        fi
    } > "$WORK/progress.txt" 2>&1
    put "$WORK/progress.txt" > /dev/null 2>&1
}

finish() {   # finish done|failed "message": pack forces and logs, put them in the bucket, stop the VM
    say "$2"
    local stamp
    stamp=$(date +%Y%m%d-%H%M%S)
    if [ -d "$CASE" ]; then
        (cd "$CASE" && tar czf "$WORK/results-small-$stamp.tar.gz" --ignore-failed-read \
            postProcessing log.* README.txt system 2> /dev/null)
        if put "$WORK/results-small-$stamp.tar.gz"; then
            say "put $OUT/results-small-$stamp.tar.gz (forces, residuals, logs)"
        else
            say "couldn't put results in $OUT (does the VM have Storage read-write access?); they're on this VM in $WORK"
        fi
    fi
    progress "$1: $2"
    say "=== $1 ==="
    if [ "$STOP" = 1 ]; then
        say "stopping this VM in 2 minutes: CPU and memory billing stop; the disk and its files stay"
        sudo shutdown -h +2 > /dev/null 2>&1
    fi
    [ "$1" = done ]
    exit $?
}

fail() { finish failed "$1"; }

say "start: source $SRC, ranks ${RANKS:-auto}, iterations ${ITERS:-as in the case}, stop at the end: $STOP"
CORES=$(lscpu -p=Core,Socket | grep -v '^#' | sort -u | wc -l)
RAM=$(awk '/MemTotal/ {printf "%d", $2 / 1048576}' /proc/meminfo)
FREE=$(df -P -BG "$WORK" | awk 'NR == 2 {print int($4)}')
say "machine: $(nproc) vCPUs, $CORES physical cores, $RAM GiB of memory, $FREE GB free disk"
progress "starting"
[ "$RAM" -ge "${RUN_MIN_RAM_GB:-8}" ] || fail "this VM has $RAM GiB of memory; set RUN_MIN_RAM_GB lower if the case really fits. Change the machine type (with the VM stopped) and run this again"
[ "$FREE" -ge 20 ] || fail "only $FREE GB of free disk; make the boot disk at least 100 GB"
RANKS=${RANKS:-$CORES}
[ "$RANKS" -le "$CORES" ] || fail "$RANKS ranks is more than the $CORES physical cores; use $CORES or fewer"

# ---------------------------------------------------------------- OpenFOAM 14 (openfoam.org)
if [ ! -f /opt/openfoam14/etc/bashrc ]; then
    say "installing OpenFOAM 14 from openfoam.org (a few minutes)"
    command -v cloud-init > /dev/null && cloud-init status --wait > /dev/null 2>&1   # first-boot package updates
    APT="sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=900 -q"
    sudo sh -c "wget -q -O - https://dl.openfoam.org/gpg.key > /etc/apt/trusted.gpg.d/openfoam.asc" \
        && sudo rm -f /etc/apt/sources.list.d/*dl_openfoam_org*list \
        && sudo add-apt-repository -y -n "http://dl.openfoam.org/ubuntu main dev" \
        || fail "couldn't add the openfoam.org package source"
    if [ "$(lsb_release -cs)" = resolute ]; then   # Ubuntu 26.04, as openfoam.org says
        sudo sed -i "s/^\(deb\).*\(http\)/\1 [arch=amd64] \2/" /etc/apt/sources.list.d/*dl_openfoam_org*list
    fi
    $APT update && $APT install -y openfoam14 || fail "installing openfoam14 failed (see the lines above)"
fi
# shellcheck disable=SC1091
source /opt/openfoam14/etc/bashrc > /dev/null 2>&1
command -v foamRun > /dev/null || fail "OpenFOAM 14 didn't load from /opt/openfoam14/etc/bashrc"
say "OpenFOAM: $(command -v foamRun)"

# ---------------------------------------------------------------- the case
if [ ! -f "$CASE/Allrun" ]; then
    cd "$WORK" || fail "no work folder $WORK"
    say "fetching $NAME.tar.gz from $SRC"
    get $NAME.tar.gz.sha256 && get $NAME.tar.gz \
        || fail "couldn't copy $NAME.tar.gz and $NAME.tar.gz.sha256 from $SRC: check the bucket name and that both files are in it"
    say "checking it against its checksum"
    sha256sum -c $NAME.tar.gz.sha256 || fail "$NAME.tar.gz doesn't match its checksum (damaged upload?): upload it again"
    tar xzf $NAME.tar.gz || fail "unpacking $NAME.tar.gz failed"
    say "unpacked into $CASE"
fi

# ---------------------------------------------------------------- solve
cd "$CASE" || fail "no case folder $CASE"
say "solving: ./Allrun $RANKS $ITERS (decomposePar first if needed; solver log: $CASE/log.foamRun)"
progress "solving"
( while sleep 600; do progress "solving"; done ) 9>&- &
PROG=$!
./Allrun "$RANKS" $ITERS 9>&-
RC=$?
pkill -P "$PROG" 2> /dev/null
kill "$PROG" 2> /dev/null
[ "$RC" -eq 0 ] || fail "Allrun stopped with an error: see log.decomposePar and log.foamRun"
say "solve finished: $(grep -c '^Time = ' log.foamRun) iterations in this run"

# ---------------------------------------------------------------- join the last save, pack the fields
say "joining the last saved iteration into one case (reconstructPar -latestTime)"
if [ ! -d processor0 ] || reconstructPar -latestTime > log.reconstructPar 2>&1; then   # a serial case needs no joining
    T=$(foamListTimes -latestTime 2> /dev/null | tail -1)
    if [ -n "$T" ] && [ "$T" != 0 ] && [ -d "$T" ]; then
        STAMP=$(date +%Y%m%d-%H%M%S)
        say "packing the flow fields at iteration $T"
        if tar cf "$WORK/results-fields-$T-$STAMP.tar" "$T" && put "$WORK/results-fields-$T-$STAMP.tar"; then
            say "put $OUT/results-fields-$T-$STAMP.tar (U p k omega nut yPlus at iteration $T, for ParaView)"
        else
            say "couldn't put the fields in $OUT; they're on this VM in $WORK"
        fi
    fi
else
    say "reconstructPar failed (see log.reconstructPar); the split results stay on this VM in $CASE"
fi
finish done "finished"
