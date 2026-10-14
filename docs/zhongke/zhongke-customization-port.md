# 中科（zhongke）定制修改移植明细

本文记录把 `new-api-custom-20261013` 发行包（基线为上游 `QuantumNous/new-api` 的
`v1.0.0-rc.23`，commit `0ab02020603d22e5613bc4cf46bfab06f8567769`）中的定制逻辑，
移植到本仓库当前分支 `merge_zhongke` 的结果。

- 目标分支基线：`f409dd330`（fork 自 upstream/main `7aa3531ef`，比 rc.23 更新约 40 个上游版本）
- 移植范围：后端 Go 逻辑；排除构建方式（Dockerfile）、价格页/详情页前端、打包相关逻辑
- 约束：不修改现有代码结构，只把缺失的逻辑追加进当前代码
- 本次未提交任何 Git commit

由于目标代码已经明显领先于 rc.23，部分定制在上游演进中已经存在（或已有更完整的实现），
下文逐项标注“已存在 / 已移植 / 不适用”。

---

## 1. 结论速览

| # | 发行包中的定制 | 目标分支状态 | 处理 |
|---|---|---|---|
| 1 | Kimi K3 消息级动态工具（`tools` 挂载在 system message） | 已存在 | 不改动 |
| 2 | OpenAI 通道 thinking 参数剥离 | 缺失 | 已移植 |
| 3 | Seedance Mini 视频输入计费 | 已存在 | 不改动 |
| 4 | Sora 视频 URL 转 base64 内联 | 缺失（Go 适配器已被 JS 插件取代） | 已移植（见 §2.3 适配说明） |
| 5 | 上游错误信息透传（不再包装） | 缺失 | 已移植 |
| 6 | 前端渠道/令牌分组界面调整 | 目标已为相同或更优状态 | 不改动 |
| 7 | 前端 i18n footer key | 仅转义写法差异，无功能变化 | 不改动 |
| 8 | Dockerfile 基础镜像改 alpine、COPY tokenizers | 构建方式 | 排除 |
| 9 | 前端价格页/详情页视频定价 | — | 按需求排除 |
| 10 | 打包（compose/Caddy/init_env/adapters/runtime/frontend 等） | — | 按需求排除 |

---

## 2. 后端 Go 变更明细

### 2.1 已存在，不需要改动的定制

#### 2.1.1 Kimi K3 消息级动态工具

发行包通过新增 `relaykit/dto/message_dynamic_tools.go`、在 `Message` 上增加
`Tools json.RawMessage` 与内部 `contentPresent`，并重写 `MarshalJSON/UnmarshalJSON`
来实现：当 system message 携带 `tools` 时，序列化结果中完全不出现 `content` 字段。

当前分支已由 commit `6e10f9bc9 fix(relay): preserve Kimi K3 dynamic tool loading messages`
实现，且实现更完整：

- `relaykit/dto/openai_request.go`：`Message.Tools`（`json:"tools,omitempty"`）已存在；
- `GeneralOpenAIRequest.MarshalJSON` 检测到“带 tools 且 content 为 nil”的消息时，使用内联
  结构体 `toolLoadingMessage` 丢弃 `content` key，其余消息保持 `"content": null`；
- `GetTokenCountMeta` 会把消息级 tools 计入 token 统计。

结论：功能等价且覆盖更全，本次不重复添加。

#### 2.1.2 Seedance Mini 视频输入计费

发行包在 `relay/channel/task/doubao/constants.go` 的硬编码价格表加入
`doubao-seedance-2-0-mini-260615`（无视频输入 23.0、有视频输入 14.0），并据此计算
`OtherRatio = 14/23`。

当前分支的 Doubao 任务渠道已改为 JS 插件 `plugins/tasks/doubao/plugin.js`，价格不再硬编码，
而是通过 `usageSchema` + 管理端定价表达式计费，且：

- 能力表已包含 `"doubao-seedance-2-0-mini-260615": { resolutions: ["480p", "720p"], videoInput: true }`；
- `videoInputRatio()` 已包含 `if (model === "doubao-seedance-2-0-mini-260615") return video ? 14 / 23 : 1;`。

结论：功能已存在，本次不重复添加。

### 2.2 已移植：OpenAI 通道 thinking 参数剥离

文件：`relay/channel/openai/adaptor.go`
函数：`(*Adaptor).ConvertOpenAIRequest`
位置：推理相关分支（OpenRouter / 转换链）之后、`dto.GetOpenAIChatCapabilities(...)` 之前。

新增逻辑：

```go
if request.THINKING != nil {
    var thinkingParam dto.Thinking
    if jsonErr := json.Unmarshal(request.THINKING, &thinkingParam); jsonErr == nil && thinkingParam.Type != "enabled" {
        request.THINKING = nil
    }
}
if !renderReasoning && request.ReasoningEffort == "none" {
    request.ReasoningEffort = ""
}
if request.EnableThinking != nil {
    var enableValue bool
    if jsonErr := json.Unmarshal(request.EnableThinking, &enableValue); jsonErr == nil && !enableValue {
        request.EnableThinking = nil
    }
}
```

作用：

- 剥离 `thinking:{type:"disabled"}` 这类“非启用”的 thinking 参数，避免上游因未知字段报错；
- 剥离 `enable_thinking:false`，让上游保持默认（继续思考）行为；
- 对纯透传请求剥离 `reasoning_effort:"none"`：kimi-k3 等上游并不会真正关闭推理，只是内部
  继续推理、返回更慢，因此回退到默认行为更合适。

与发行包的差异（有意保留）：发行包无条件剥离 `reasoning_effort:"none"`；当前分支新增了
`!renderReasoning` 条件。原因是当前分支已有完整的 reasoning 意图转换框架
（`relaykit/relayconvert/reasoning`），当请求经过转换链 / 模型后缀 / 显式 reasoning 时，
框架会把“关闭推理”的意图规范化，此时再剥离 `"none"` 会破坏框架语义。条件化后，
纯透传路径（即发行包要修的实际场景）行为一致，转换路径不受影响。

### 2.3 已移植：Sora 视频 URL 转 base64 内联

发行包在 `relay/channel/task/sora/` 下新增 `video_url.go`，并在其 `BuildRequestBody` /
`ValidateRequestAndSetAction` 中接入：把 JSON 请求体中 video 类字段的 http(s) 链接下载后
转成 `data:video/...;base64,...`，用于不支持远程视频 URL 的 Sora 兼容上游。

当前分支的 Sora 渠道（`constant.ChannelTypeSora = 55`）已改为 JS 插件
`plugins/tasks/sora/plugin.js`，不存在 Go 版 Sora 适配器，因此没有原样对应的挂载点。
按“不修改结构、只加逻辑”的要求，采取如下等价落点：

新增文件 `relay/channel/task/jsplugin/video_url.go`（移植自发行包同名逻辑）：

- `inlineVideoURLs(c, payload)`：遍历已解码的 JSON body，把视频 URL 重写为 data URI；
- `convertVideoURLs` / `convertVideoURLValue`：递归遍历 map/array/string，识别
  `video`、`videos`、`video_url`、`video_urls`、`videourl`、`videourls`、`input_video` 等字段，
  以及 `type` 含 `video` 的对象中的 `url` 字段；
- `loadVideoDataURI`：经 `service.LoadFileSource(c, types.NewURLFileSource(url), "video_url_to_base64")`
  下载并缓存，校验 MIME 必须为 `video/*`，再做 base64 编码；
- 总量限制沿用 `constant.MaxFileDownloadMB`（默认由 `MAX_FILE_DOWNLOAD_MB` 控制，默认 64MB）。

接入点 `relay/channel/task/jsplugin/adaptor.go` 的 `BuildRequestBody`，在
`inlineJSONFilePlaceholders` 之后、`common.Marshal` 之前：

```go
if a.plugin.Meta.Key == "sora" {
    inlined, err = inlineVideoURLs(c, inlined)
    if err != nil {
        return nil, err
    }
}
```

与发行包的差异（有意保留）：

- 发行包把逻辑放在 Go 的 Sora 专用适配器里，天然只影响 Sora 渠道；当前分支只能挂在通用
  `jsplugin` 适配器上，因此用 `a.plugin.Meta.Key == "sora"` 限定作用域，避免影响
  Doubao/Ark 等“上游本就接受 URL”的插件（否则会把它们的参考视频 URL 也下载内联）；
- 仅作用于 JSON body（`BuildRequestBody` 的非 multipart 分支），multipart 上传仍走
  `inlineJSONFilePlaceholders` 的既有 dataUrl/base64 能力。

新增测试 `relay/channel/task/jsplugin/video_url_test.go`，直接移植发行包用例：
普通视频 URL 被转换、已存在的 data URI 不变、图片 URL 不变、非 video 字段的顶层 `url` 不变、
总量超限报错、loader 错误透传。

### 2.4 已移植：上游错误信息透传

文件：`service/error.go`
函数：`RelayErrorHandler`

变更：

- 当解析出的错误 message 为空时，回退为原始响应体文本 `message = responseBodyText`，
  避免客户端只看到通用的 `bad_response_status_code`；
- 移除结尾处 `if showBodyWhenFail { newApiErr.Err = buildErrWithBody(...) }` 的包装，
  直接把上游 message 作为错误透传，不再拼上状态码与整段 body。

`buildErrWithBody` 仍被前方“JSON 解析失败”“object 型错误”分支使用，未产生死代码。
注意：未沿用发行包对该文件的 CRLF 行尾改动，保持仓库原有 LF。

---

## 3. 前端变更说明

发行包相对 rc.23 的前端改动分两类，均无需移植：

1. **渠道/令牌分组界面调整**（`channel-mutate-drawer.tsx`、`channel-form.ts`、
   `api-key-group-cell.tsx`）：本质是格式化换行，以及隐藏 `AutoGroupBadge`。
   当前分支已处于相同或更新状态：
   - `channel-form.ts` 的 `http2_connection_shards: protocol === HTTP_PROTOCOL_HTTP1 ? 1 : shards`
     已是单行写法；
   - `channel-mutate-drawer.tsx` 的 `<SelectContent alignItemWithTrigger={false}>` 已是单行写法；
   - `api-key-group-cell.tsx` 已不再渲染 `AutoGroupBadge`（仅保留 `auto-group-visuals.tsx` 中的定义）。
2. **i18n footer key**：发行包把 `footer.new\u0061pi.projectAttributionSuffix` 写成
   `footer.newapi.projectAttributionSuffix`。`\u0061` 就是字符 `a`，两者是同一个 JSON key，
   无任何功能差异，故不改动。
3. **价格页/详情页视频定价**（`web/src/features/pricing/*` 与相关 i18n 文案）：按需求排除，
   未移植。

---

## 4. 变更文件清单

修改：

- `relay/channel/openai/adaptor.go`（+23 行）：thinking 参数剥离
- `service/error.go`（+6 −5）：上游错误透传
- `relay/channel/task/jsplugin/adaptor.go`（+10 行）：Sora JSON body 视频 URL 内联钩子

新增：

- `relay/channel/task/jsplugin/video_url.go`（122 行）
- `relay/channel/task/jsplugin/video_url_test.go`（97 行）

未改动（已存在）：`relaykit/dto/openai_request.go`、`plugins/tasks/doubao/plugin.js`。

---

## 5. 验证情况

本机原先无 Go 工具链，已用 `mise` 安装 `go@1.26.8`（仅用于本次验证的开发工具，未写入仓库配置）。
执行命令与结果：

```bash
go build ./relay/channel/openai/... ./service/... ./relay/channel/task/jsplugin/...   # BUILD_OK
go vet   ./relay/channel/openai/... ./service/... ./relay/channel/task/jsplugin/...   # 无告警
go test  ./relay/channel/task/jsplugin/ -run 'TestConvertVideoURLs' -count=1          # ok
go test  -run 'TestNoSuchTestXYZ' -count=1 ./relay/channel/openai/... ./service/...   # 编译通过
```

说明：

- `go build ./...` 在 `main.go:44` 报 `pattern web/dist: no matching files found`，
  这是前端未构建导致的既有 embed 依赖，与本次改动无关；受影响包均已单独编译通过。
- thinking 剥离与错误透传沿用发行包做法，未新增单元测试（发行包同样没有）。

---

## 6. 风险与未验证项

1. **Sora 内联的作用域**：以插件 key `"sora"` 判定。若管理员用自定义/覆盖插件接管
   渠道类型 55 且插件 key 不是 `sora`，则不会触发内联；若自定义插件 key 恰为 `sora`
   但上游接受远程 URL，则会多一次下载。属于发行包“Sora 专用”语义在插件化架构下的等价近似。
2. **下载依赖运行环境**：`service.LoadFileSource` 需要能访问目标视频 URL，且受
   `MAX_FILE_DOWNLOAD_MB` 与请求上下文限制；失败时整个提交请求失败（与发行包一致）。
3. **`reasoning_effort:"none"` 的条件化**：仅在 `!renderReasoning` 时剥离。若希望与发行包
   完全一致（无条件剥离），需要评估当前分支 reasoning 转换框架的回归风险。
4. **未做端到端验证**：未在真实 Sora/火山渠道上验证视频内联与错误透传的实际效果，
   也未运行完整 `go test ./...`（仓库级测试面较大）。

---

## 7. 与发行包文件对应关系

| 发行包（rc.23） | 目标分支 | 处理 |
|---|---|---|
| `relaykit/dto/message_dynamic_tools.go`（新增） | 无（能力内联在 `openai_request.go`） | 已存在，跳过 |
| `relaykit/dto/openai_request.go` | 同路径 | 已存在，跳过 |
| `relay/channel/openai/adaptor.go` | 同路径 | 已移植 |
| `relay/channel/task/doubao/constants.go` | `plugins/tasks/doubao/plugin.js` | 已存在，跳过 |
| `relay/channel/task/sora/video_url.go` + `adaptor.go` | `relay/channel/task/jsplugin/video_url.go` + `adaptor.go` | 已移植（限定 sora 插件） |
| `service/error.go` | 同路径 | 已移植 |
| `Dockerfile` | — | 排除（构建方式） |
| `web/src/features/pricing/*` | — | 排除（价格页/详情页） |
| `web/src/features/channels/*`、`web/src/features/keys/*` | 同路径 | 已为相同/更优状态 |
| `web/src/i18n/locales/*` | 同路径 | footer key 转义等价，不改 |
| `compose.yml`/`Caddyfile`/`init_env.py`/`adapters/` 等 | — | 排除（打包） |
