FROM python:3.12-slim@sha256:520153e2deb359602c9cffd84e491e3431d76e7bf95a3255c9ce9433b76ab99a

# Optional pull-through cache endpoints (req 018). Empty defaults so the
# Dockerfile remains valid in production builds where the cache services
# do not exist. Populated by the e2e harness via compose build.args.
ARG INFINITO_CACHE_APT_PROXY=""
ARG INFINITO_CACHE_PIP_INDEX_URL=""

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY requirements.lock /app/requirements.lock
RUN if [ -n "$INFINITO_CACHE_PIP_INDEX_URL" ]; then \
        pip config set global.index-url "$INFINITO_CACHE_PIP_INDEX_URL"; \
        pip config set global.trusted-host "$(printf '%s' "$INFINITO_CACHE_PIP_INDEX_URL" | awk -F[/:] '{print $4}')"; \
    fi \
 && pip install --no-cache-dir --require-hashes -r /app/requirements.lock \
 && rm -f /root/.config/pip/pip.conf /root/.pip/pip.conf

RUN if [ -n "$INFINITO_CACHE_APT_PROXY" ]; then \
        printf 'Acquire::http::Proxy "%s";\n' "$INFINITO_CACHE_APT_PROXY" > /etc/apt/apt.conf.d/01infinito-cache; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gnupg iputils-ping openssh-client openssl \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && . /etc/os-release \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && groupadd -g 10900 infinito-manager \
    && groupadd -g 10001 api \
    && groupadd -g 10003 runner-manager \
    && useradd -u 10001 -g 10001 -G infinito-manager -M -N -r -s /usr/sbin/nologin api \
    && useradd -u 10003 -g 10003 -G infinito-manager -M -N -r -s /usr/sbin/nologin runner-manager \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/01infinito-cache

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
