# node_otel_exporter

running otel demo with wsl ip in powershell

```
$WSL_IP = wsl hostname -I | ForEach-Object { $_.Split(" ")[0] }
docker compose up -d --force-recreate

```
