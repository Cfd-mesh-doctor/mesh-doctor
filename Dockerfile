# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# Mesh Doctor + OpenFOAM 14 (openfoam.org) in one image.
#
#   docker build -t meshdoctor .
#   docker run --rm -p 127.0.0.1:8765:8765 \
#       -v /path/to/cases:/cases:ro -v meshdoctor-work:/work meshdoctor
#
# then open http://localhost:8765.  The source cases are mounted read-only;
# every copy and result goes to the /work volume.  Publish the port on
# 127.0.0.1 only (as above), never on all interfaces.
# Other commands:  docker run --rm -v ... meshdoctor full /cases/<case> <name>
#
# Release builds pin the base image by digest (FROM ubuntu:22.04@sha256:...).
ARG BASE=ubuntu:22.04
FROM ${BASE}

ARG DEBIAN_FRONTEND=noninteractive
# OpenFOAM 14 from the openfoam.org package repository (signed; key checked by apt)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget gnupg python3 python3-numpy procps \
 && wget -qO /etc/apt/trusted.gpg.d/openfoam.asc https://dl.openfoam.org/gpg.key \
 && echo "deb http://dl.openfoam.org/ubuntu jammy main" > /etc/apt/sources.list.d/openfoam.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends openfoam14 \
 && rm -rf /var/lib/apt/lists/*

# build the utilities into the OpenFOAM site folder, as root, once
COPY . /opt/mesh-doctor
RUN bash -c ". /opt/openfoam14/etc/bashrc && /opt/mesh-doctor/Allwmake -site"

# run as an ordinary user; /cases (read-only) and /work are mounted at run time
RUN useradd -m -u 1000 md && mkdir -p /cases /work && chown md /work
USER md
WORKDIR /opt/mesh-doctor
ENV MESHDOCTOR_CASES=/cases \
    MESHDOCTOR_WORKSPACE=/work/meshdoctor \
    MESHDOCTOR_FOAM_BASHRC=/opt/openfoam14/etc/bashrc
EXPOSE 8765
ENTRYPOINT ["python3", "-m", "meshdoctor"]
CMD ["serve", "--container"]
