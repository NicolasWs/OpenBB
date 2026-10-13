# JupyterLab for the self-hosted OpenBB server

A browser UI for exploring OpenBB data on nicogeek: tables, charts, and Excel/CSV exports.
JupyterLab runs next to the existing `openbb-api` container and queries it over HTTP.
The helper `notebooks/obb.py` turns any endpoint into a pandas DataFrame.

## Start (on nicogeek)

```bash
cd ~/OpenBB && git pull                      # this folder is on branch claude/festive-fermi-1rqvmh
cd jupyter
echo "JUPYTER_TOKEN=$(openssl rand -hex 16)" > .env   # once; this is your login token
docker compose up -d
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8888
grep JUPYTER_TOKEN .env                       # copy the token
```

On the Mac (on the tailnet), open `https://nicogeek.tailaaacd4.ts.net:8443/lab?token=<token>`, then
open **openbb-quickstart.ipynb** and run the cells top to bottom (Shift+Enter).

Jupyter listens on the host's loopback only (`127.0.0.1:8888`). `tailscale serve` adds HTTPS and
keeps it private to the tailnet. The token protects it as well.

## Use

```python
import obb
obb.providers()                                   # installed providers
obb.endpoints("treasury")                         # search ~1,000 endpoints
obb.params("fixedincome/government/yield_curve")  # parameters of one endpoint
df = obb.get("equity/price/historical", symbol="AAPL", provider="cboe")
df.to_excel("aapl.xlsx", index=False)              # then right-click > Download in the file browser
```

New notebooks are saved in `notebooks/` on nicogeek. They are not committed to git.

## Notes

- Keyless providers work immediately. FRED, BLS, EIA, CFTC and Congress need API keys set on
  the **server** (`openbb-api`): put them in `user_settings.json` or env vars, then restart the container.
- On this server, nasdaq historical prices return no data, so use `provider="cboe"`.
- Stop: `docker compose down`. Update the image: `docker compose pull && docker compose up -d`.
- CasaOS: you can also import `docker-compose.yml` with **App Store → Custom install → Import**.
  Keep the `.env` token or set `JUPYTER_TOKEN` in the app's environment settings.
