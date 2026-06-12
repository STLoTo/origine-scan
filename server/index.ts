import { serverConfig } from "./config";
import app from "./app";

app.listen(serverConfig.port, () => {
  console.log(`OrigineScan API → http://localhost:${serverConfig.port}`);
});
