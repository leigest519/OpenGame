# 可选公共模块

`waves.ts` 提供 WaveScheduler。用途为分批出现的敌人、障碍或目标，不限定游戏类型；不依赖 Phaser，也不创建敌人、计分或发放奖励。

构造参数为波次清单和 `spawn(wave, index)` 回调。场景每次更新调用 `update(deltaMs)`；卸载或重新开始调用 `stop()`，新一局创建新实例。`complete` 只表示调度结束，不表示所有敌人已经消失。时间单位为毫秒，异常大时间步长限制为 100ms。

版本 0.1.0。按需复制到项目 `src/modules` 并记录 modules.lock.json。可自由编写缺失能力；对公共模块的本地修改必须记录来源。

设计起点为现有 tower_defense WaveManager 的调度职责，剥离了 Scene、敌人计数与奖励。跨玩法验收仍待完成，当前不宣称已经验证所有组合。

## 合成音效

`audio.ts` 提供不依赖引擎或网络的 `GameAudio`（版本 0.1.0）。复制到 `src/modules/audio.ts` 并记录来源。支持 `click`、`build`、`upgrade`、`sell`、`shoot`、`hit`、`reward`、`damage`、`wave`、`win`、`lose`；根据玩法选择并可调整音色，不要求每个游戏出现全部事件。

创建一个实例；开始按钮或其他真实交互中调用 `await audio.unlock()`，然后 `audio.play('build')` 等。不要为每次发声创建实例，不要积压解锁之前的声音。密集事件有节流，总发声数上限为八个，短音使用起落包络避免硬切。

静音按钮调用 `audio.setMuted(!audio.muted)` 并同步可见文案/状态。暂停和失焦调用 `audio.setPaused(true)`，玩家点击继续时先 `await audio.unlock()` 再调用 `audio.setPaused(false)`，以恢复浏览器可能挂起的音频；重开先 `audio.stopAll()` 再取消暂停，保留静音偏好。退出或销毁游戏时 `audio.dispose()`。不要仅把声音挂在装饰按钮上，应接入玩法状态实际改变的位置。

没有 Web Audio 或浏览器未解锁时，`unlock()` / `play()` 返回 false，玩法继续。`unlock()` 不代表玩家已听到声音，源码中存在模块也不证明所有事件已接入。背景音乐、语音与外部音频资源不在本模块范围。
