FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
ARG FRR_VERSION=10.7.1-0~deb12u1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://deb.frrouting.org/frr/keys.gpg -o /usr/share/keyrings/frrouting.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/frrouting.gpg] https://deb.frrouting.org/frr bookworm frr-stable' > /etc/apt/sources.list.d/frr.list \
    && apt-get update && apt-get install -y --no-install-recommends \
       frr=${FRR_VERSION} iproute2 iputils-ping traceroute tcpdump iperf3 procps \
       python3 python3-fastapi python3-uvicorn \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend /app/backend
COPY dist /app/dist
COPY tests /app/tests
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
