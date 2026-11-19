/** 등록하는 슬래시 명령. 이름과 옵션 이름은 한국어다. */

/** integration_types 0=서버에 설치, 1=사용자에게 설치 · contexts 0=서버, 1=봇과의 DM, 2=그 밖의 DM. */
const EVERYWHERE = { type: 1, integration_types: [0, 1], contexts: [0, 1, 2] } as const

export const CMD = { ate: '먹었어', weight: '체중', today: '오늘', coach: '코치' } as const
export const OPT = { text: '내용', photo: '사진', kg: 'kg', question: '질문' } as const

export const MIN_KG = 30
export const MAX_KG = 300

export const COMMANDS = [
  {
    ...EVERYWHERE,
    name: CMD.ate,
    description: '먹은 것을 적으면 칼로리를 어림잡아 오늘 기록에 넣어요',
    options: [
      { type: 3, name: OPT.text, description: '무엇을 얼마나 먹었는지 (예: 김치찌개랑 밥 한 공기)', required: true, max_length: 500 },
      { type: 11, name: OPT.photo, description: '식사 사진 (JPEG, PNG, WebP · 3MB 이하)', required: false },
    ],
  },
  {
    ...EVERYWHERE,
    name: CMD.weight,
    description: '오늘 잰 체중을 기록해요',
    options: [{ type: 10, name: OPT.kg, description: '체중(kg)', required: true, min_value: MIN_KG, max_value: MAX_KG }],
  },
  { ...EVERYWHERE, name: CMD.today, description: '오늘 먹은 양과 이번 주 평균을 보여 줘요' },
  {
    ...EVERYWHERE,
    name: CMD.coach,
    description: '내 기록을 아는 코치에게 물어봐요',
    options: [{ type: 3, name: OPT.question, description: '묻고 싶은 것', required: true, max_length: 500 }],
  },
]

/** '방금 기록 취소' 버튼의 custom_id 앞머리. 뒤에 식사 묶음 키가 붙는다. */
export const UNDO_PREFIX = 'undo:'
