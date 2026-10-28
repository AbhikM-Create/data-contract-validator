# dcv in a container, for pipelines (Airflow, Azure Data Factory, Databricks,
# Jenkins) that run steps as images.
#
#   docker build -t data-contract-validator:2.0.0 --build-arg DCV_COMMIT=$(git rev-parse --short=12 HEAD) .
#   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/data" data-contract-validator:2.0.0 \
#     reconcile employees.migration.json legacy.csv target.csv --evidence pack.html --junit results.xml
#
# Files are read from the mounted directory and never leave the container's
# host; partitions for large files go to the container's /tmp and are deleted
# when the run ends.
#
# Pin the base image to a digest for reproducible builds:
#   --build-arg NODE_IMAGE=node:22-alpine@sha256:<digest>
ARG NODE_IMAGE=node:22-alpine

# Stage 1: `npm pack` — the package's "files" list decides what ships, so the
# image holds exactly what `npm install` of the package would.
FROM ${NODE_IMAGE} AS pack
WORKDIR /src
COPY . .
RUN npm pack --pack-destination /tmp

# Stage 2: install that package and nothing else, run as an unprivileged user.
FROM ${NODE_IMAGE}
ARG DCV_COMMIT=""
ENV DCV_COMMIT=${DCV_COMMIT}
COPY --from=pack /tmp/data-contract-validator-*.tgz /tmp/dcv.tgz
RUN npm install --global --omit=dev --ignore-scripts /tmp/dcv.tgz \
 && rm /tmp/dcv.tgz \
 && npm cache clean --force
USER node
WORKDIR /data
ENTRYPOINT ["dcv"]
CMD ["--help"]
