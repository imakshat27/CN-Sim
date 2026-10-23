FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    frr iproute2 iputils-ping traceroute tcpdump iperf3 procps \
    python3 python3-fastapi python3-uvicorn ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend /app/backend
COPY dist /app/dist
COPY tests /app/tests
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
