module.exports = [
  {
    id: 'project-delay',
    title: '项目延期',
    role: '产品负责人',
    background: '上线前，团队正在确认支付链路是否具备发布条件。',
    speech: '我建议把上线时间往后推一周。现在支付回调偶尔重复，虽然不一定每次都出现，但一旦正式上线，可能造成重复扣款。我们可以先完成压测和补偿方案，再确定新的上线时间。',
    audioUrl: '/assets/audio/scenario-01.mp3',
    enabled: true
  },
  {
    id: 'late-scope-addition',
    title: '临时增加需求',
    role: '项目负责人',
    background: '版本临近冻结，客户又提出了一个验收相关需求。',
    speech: '客户刚刚提出，希望这周把数据导出也加进版本里。他们觉得没有导出就没法做月报。我知道排期已经很紧，但如果现在不做，可能会影响验收，所以我倾向先把其他一个小功能挪走。',
    audioUrl: '/assets/audio/scenario-02.mp3',
    enabled: true
  },
  {
    id: 'scope-reduction',
    title: '范围收缩',
    role: '业务负责人',
    background: '需求持续增加，团队需要在日期、范围和质量之间做选择。',
    speech: '这个项目最近每天都在加需求，设计和开发都已经满负荷。如果还是按原定日期交付，我建议只保留核心流程，报表和通知先放到下一期，否则很可能每个功能都做不稳。',
    audioUrl: '/assets/audio/scenario-03.mp3',
    enabled: true
  },
  {
    id: 'data-dispute',
    title: '数据结果争议',
    role: '增长负责人',
    background: '新入口上线一周，点击和完成数据给出了不同信号。',
    speech: '从上周的数据看，新入口的点击率确实提高了，但完成率反而下降。我怀疑用户是被按钮吸引进来，却没有看懂后面的步骤。我的建议是先别扩大流量，先把第二步说明改清楚再观察三天。',
    audioUrl: '/assets/audio/scenario-04.mp3',
    enabled: true
  },
  {
    id: 'integration-delay',
    title: '跨团队联调延期',
    role: '合作团队负责人',
    background: '联调窗口已定，但对方测试环境暂时被其他项目占用。',
    speech: '接口文档我们可以今天给，但测试环境最快要到周四，因为现在还有另一个项目在占用。如果你们必须周三联调，我们只能先提供一个模拟接口，但模拟数据不能覆盖所有异常情况。',
    audioUrl: '/assets/audio/scenario-05.mp3',
    enabled: true
  },
  {
    id: 'campaign-effect',
    title: '活动效果判断',
    role: '活动负责人',
    background: '复盘会上，团队对高报名、低到场的结果有不同判断。',
    speech: '我觉得这次活动效果不差，曝光和报名都比上次高，所以可以继续沿用现在的方案。至于到场率低，可能只是天气原因，没有必要马上调整整个流程。',
    audioUrl: '/assets/audio/scenario-06.mp3',
    enabled: true
  }
];
