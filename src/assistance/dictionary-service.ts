/**
 * DictionaryService —— 混合查词服务。
 *
 * 策略: 首次查词时 ping 在线 API, <1s 响应则用在线, 否则回退到本地词典。
 * 本地词典由 scripts/build-dict.py 生成 (public/dict.json)。
 * 内置 mini 词典覆盖最常用的 ~500 词, 确保离线也能用。
 */

import { safeFetch } from '../shared/fetch-utils.js';
import { logger } from '../shared/logger.js';

const log = logger.createLogger('dict');

// ---- 类型 ----

export interface WordDefinition {
  word: string;
  /** 音标(IPA) */
  phonetic?: string;
  /** 英式发音 IPA */
  phoneticUK?: string;
  /** 美式发音 IPA */
  phoneticUS?: string;
  /** 英式发音音频 URL */
  audioUK?: string;
  /** 美式发音音频 URL */
  audioUS?: string;
  /** 词性 + 释义 */
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
    }>;
  }>;
}

/** 本地词典压缩格式: { 词: { p:"词性", d:["释义",...], e:["例句",...] } } */
interface CompactEntry {
  p?: string;
  d: string[];
  e?: string[];
}

/** 远程 API 响应 */
interface DictApiEntry {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
}

// ---- 配置 ----

const ONLINE_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const ONLINE_TIMEOUT_MS = 4000;

// ---- 内置 mini 词典 (最常用 ~500 词, 确保离线不空) ----

const MINI_DICT: Record<string, CompactEntry> = {
  abandon: { p: 'v.', d: ['To give up completely; to forsake.'] },
  ability: { p: 'n.', d: ['The quality or state of being able; power to perform.'] },
  able: { p: 'adj.', d: ['Having sufficient power, skill, or resources.'] },
  about: { p: 'adv./prep.', d: ['On the subject of; concerning.', 'Approximately; nearly.'] },
  above: { p: 'adv./prep.', d: ['In or to a higher place; overhead.'] },
  abroad: { p: 'adv.', d: ['In or to a foreign country.'] },
  absence: { p: 'n.', d: ['The state of being away or not present.'] },
  absolute: { p: 'adj.', d: ['Complete; total; not limited in any way.'] },
  accept: { p: 'v.', d: ['To receive willingly; to agree to.'] },
  access: { p: 'n./v.', d: ['The right or ability to enter or use.', 'To obtain or retrieve.'] },
  accident: { p: 'n.', d: ['An unfortunate incident that happens unexpectedly.'] },
  account: { p: 'n./v.', d: ['A report or description of an event.', 'To consider or regard.'] },
  achieve: { p: 'v.', d: ['To reach or attain by effort; to accomplish.'] },
  across: { p: 'adv./prep.', d: ['From one side to the other; on the opposite side.'] },
  action: { p: 'n.', d: ['The process of doing something; a deed.'] },
  activity: { p: 'n.', d: ['The condition in which things are happening or being done.'] },
  actual: { p: 'adj.', d: ['Existing in fact; real.'] },
  address: { p: 'n./v.', d: ['The place of residence or business.', 'To speak to or deal with.'] },
  admit: { p: 'v.', d: ['To confess or acknowledge; to allow entry.'] },
  adult: { p: 'n./adj.', d: ['A fully grown person.', 'Fully developed and mature.'] },
  advance: { p: 'v./n.', d: ['To move forward; to make progress.', 'Progress or improvement.'] },
  advantage: { p: 'n.', d: ['A condition giving a greater chance of success.'] },
  affair: { p: 'n.', d: ['An event or matter of interest or importance.'] },
  affect: { p: 'v.', d: ['To have an influence on; to produce a change in.'] },
  afford: { p: 'v.', d: ['To have enough money to pay for.', 'To provide or supply.'] },
  afraid: { p: 'adj.', d: ['Feeling fear or anxiety; frightened.'] },
  afternoon: { p: 'n.', d: ['The time from noon to evening.'] },
  agency: { p: 'n.', d: ['A business or organization providing a particular service.'] },
  agent: { p: 'n.', d: ['A person who acts on behalf of another.', 'A spy.'] },
  agreement: { p: 'n.', d: ['A negotiated arrangement between parties.'] },
  ahead: { p: 'adv.', d: ['In front; in advance.'] },
  allow: { p: 'v.', d: ['To permit or let happen; to acknowledge.'] },
  almost: { p: 'adv.', d: ['Nearly; not quite.'] },
  although: { p: 'conj.', d: ['In spite of the fact that; even though.'] },
  amount: { p: 'n./v.', d: ['A quantity or total.', 'To add up (to).'] },
  ancient: { p: 'adj.', d: ['Belonging to the very distant past.'] },
  announce: { p: 'v.', d: ['To make a public declaration.'] },
  annual: { p: 'adj.', d: ['Occurring once every year.'] },
  anybody: { p: 'pron.', d: ['Any person; anyone.'] },
  anyway: { p: 'adv.', d: ['In any case; regardless.'] },
  apart: { p: 'adv.', d: ['Separated by a distance; into pieces.'] },
  apartment: { p: 'n.', d: ['A set of rooms for living in; a flat.'] },
  appeal: { p: 'n./v.', d: ['A request for help or support.', 'To be attractive or interesting.'] },
  appear: { p: 'v.', d: ['To come into sight; to seem.'] },
  approach: { p: 'v./n.', d: ['To come near or closer.', 'A way of dealing with something.'] },
  argue: { p: 'v.', d: ['To exchange diverging views; to dispute.'] },
  argument: { p: 'n.', d: ['A reason given for or against something.', 'A verbal dispute.'] },
  arrange: { p: 'v.', d: ['To put into a proper order; to organize.'] },
  arrest: { p: 'v./n.', d: ['To seize by legal authority.', 'The act of arresting.'] },
  arrival: { p: 'n.', d: ['The action of arriving; coming to a place.'] },
  article: { p: 'n.', d: ['A piece of writing in a newspaper.', 'A particular item.'] },
  aside: { p: 'adv.', d: ['To one side; out of the way.'] },
  aspect: { p: 'n.', d: ['A particular part or feature of something.'] },
  assess: { p: 'v.', d: ['To evaluate or estimate the nature or value of.'] },
  asset: { p: 'n.', d: ['A useful or valuable thing or person.'] },
  assume: { p: 'v.', d: ['To suppose without proof; to take on.'] },
  attack: { p: 'v./n.', d: ['To take aggressive action against.', 'An act of aggression.'] },
  attempt: { p: 'v./n.', d: ['To make an effort; to try.', 'An effort to achieve.'] },
  attend: { p: 'v.', d: ['To be present at.', 'To deal with or pay attention to.'] },
  attention: { p: 'n.', d: ['Notice taken of someone or something.'] },
  attitude: { p: 'n.', d: ['A settled way of thinking or feeling.'] },
  attract: { p: 'v.', d: ['To draw or pull toward oneself.'] },
  audience: { p: 'n.', d: ['The assembled listeners or spectators.'] },
  author: { p: 'n.', d: ['The writer of a book or article.'] },
  authority: { p: 'n.', d: ['The power to give orders or make decisions.'] },
  average: { p: 'n./adj.', d: ['The typical or normal amount.', 'Ordinary; not special.'] },
  avoid: { p: 'v.', d: ['To keep away from; to prevent.'] },
  award: { p: 'n./v.', d: ['A prize given for achievement.', 'To give as a prize.'] },
  aware: { p: 'adj.', d: ['Having knowledge or perception of a situation.'] },
  balance: { p: 'n./v.', d: ['An even distribution of weight.', 'To keep steady.'] },
  barrier: { p: 'n.', d: ['An obstacle that prevents movement or access.'] },
  battle: { p: 'n./v.', d: ['A sustained fight between organized forces.', 'To fight.'] },
  behalf: { p: 'n.', d: ['In the interests of a person or group.'] },
  behave: { p: 'v.', d: ['To act in a certain way; to conduct oneself.'] },
  behaviour: { p: 'n.', d: ['The way in which one acts.'] },
  belief: { p: 'n.', d: ['An acceptance that something is true.'] },
  belong: { p: 'v.', d: ['To be the property of; to be a member of.'] },
  beneath: { p: 'prep./adv.', d: ['In or to a lower position.', 'Below.'] },
  benefit: { p: 'n./v.', d: ['An advantage or profit.', 'To gain or receive advantage.'] },
  besides: { p: 'prep./adv.', d: ['In addition to; apart from.'] },
  billion: { p: 'n.', d: ['The number equivalent to one thousand million.'] },
  bind: { p: 'v.', d: ['To tie or fasten tightly.', 'To impose a legal obligation.'] },
  border: { p: 'n./v.', d: ['A line separating two areas.', 'To be adjacent to.'] },
  bother: { p: 'v.', d: ['To take the trouble; to annoy or worry.'] },
  boundary: { p: 'n.', d: ['A line marking the limits of an area.'] },
  brain: { p: 'n.', d: ['The organ inside the head that controls thought.'] },
  branch: { p: 'n./v.', d: ['A part of a tree growing from the trunk.', 'To divide.'] },
  breath: { p: 'n.', d: ['The air taken into or expelled from the lungs.'] },
  bridge: { p: 'n./v.', d: ['A structure crossing over a river or gap.', 'To connect.'] },
  brief: { p: 'adj.', d: ['Of short duration; concise.'] },
  broadcast: { p: 'v./n.', d: ['To transmit by radio or television.', 'A TV or radio program.'] },
  budget: { p: 'n./v.', d: ['An estimate of income and expenditure.', 'To plan spending.'] },
  burden: { p: 'n./v.', d: ['A heavy load.', 'To load heavily.'] },
  cabinet: { p: 'n.', d: ['A cupboard with drawers or shelves.', 'A group of advisors.'] },
  campaign: { p: 'n./v.', d: ['A series of actions to achieve a goal.', 'To work toward a goal.'] },
  capable: { p: 'adj.', d: ['Having the ability or capacity to do something.'] },
  capacity: { p: 'n.', d: ['The maximum amount that can be contained.', 'The ability to do.'] },
  capture: { p: 'v./n.', d: ['To take into possession by force.', 'The act of capturing.'] },
  career: { p: 'n.', d: ['An occupation undertaken for a significant period of time.'] },
  carrier: { p: 'n.', d: ['A person or thing that carries or delivers.'] },
  category: { p: 'n.', d: ['A class or division of things sharing characteristics.'] },
  celebrate: { p: 'v.', d: ['To mark a special occasion with festivities.'] },
  chairman: { p: 'n.', d: ['The person in charge of a meeting or organization.'] },
  challenge: { p: 'n./v.', d: ['A call to prove or justify something.', 'To dispute or question.'] },
  chamber: { p: 'n.', d: ['A room used for a particular purpose.'] },
  champion: { p: 'n.', d: ['A person who has defeated all opponents.'] },
  channel: { p: 'n./v.', d: ['A TV station.', 'A path for water or communication.', 'To direct.'] },
  chapter: { p: 'n.', d: ['A main division of a book.'] },
  character: { p: 'n.', d: ['The mental and moral qualities of an individual.', 'A person in a story.'] },
  charity: { p: 'n.', d: ['An organization set up to help those in need.', 'Generosity.'] },
  chemical: { p: 'adj./n.', d: ['Relating to chemistry.', 'A substance produced by chemistry.'] },
  citizen: { p: 'n.', d: ['A legally recognized member of a state or country.'] },
  claim: { p: 'v./n.', d: ['To assert as a fact; to demand as a right.', 'An assertion.'] },
  climate: { p: 'n.', d: ['The weather conditions of a region over a long period.'] },
  clinical: { p: 'adj.', d: ['Relating to the observation and treatment of patients.'] },
  coalition: { p: 'n.', d: ['A temporary alliance of groups or parties.'] },
  cognitive: { p: 'adj.', d: ['Relating to mental processes of understanding.'] },
  collapse: { p: 'v./n.', d: ['To fall down or give way suddenly.', 'A sudden failure.'] },
  colleague: { p: 'n.', d: ['A person with whom one works in a profession.'] },
  command: { p: 'v./n.', d: ['To give an order; to have authority over.', 'An order.'] },
  comment: { p: 'n./v.', d: ['A remark expressing an opinion.', 'To make a remark.'] },
  commission: { p: 'n./v.', d: ['A fee paid for services.', 'To authorize or order.'] },
  commitment: { p: 'n.', d: ['The state of being dedicated to a cause.', 'A pledge.'] },
  committee: { p: 'n.', d: ['A group of people appointed for a specific function.'] },
  communicate: { p: 'v.', d: ['To share or exchange information.'] },
  comparison: { p: 'n.', d: ['The act of evaluating similarities and differences.'] },
  competition: { p: 'n.', d: ['The activity of competing against others.'] },
  complaint: { p: 'n.', d: ['An expression of dissatisfaction.'] },
  complex: { p: 'adj./n.', d: ['Consisting of many connected parts.', 'A group of related things.'] },
  component: { p: 'n.', d: ['A part or element of a larger whole.'] },
  conceive: { p: 'v.', d: ['To form or devise a plan in the mind.', 'To become pregnant.'] },
  concentrate: { p: 'v.', d: ['To focus attention or effort.', 'To gather together.'] },
  concept: { p: 'n.', d: ['An abstract idea.'] },
  concern: { p: 'n./v.', d: ['Anxiety or worry.', 'To relate to or affect.'] },
  conclude: { p: 'v.', d: ['To bring to an end; to reach a judgment.'] },
  conduct: { p: 'n./v.', d: ['The manner of behaving.', 'To organize and carry out.'] },
  conference: { p: 'n.', d: ['A formal meeting for discussion.'] },
  confidence: { p: 'n.', d: ['The feeling of self-assurance.', 'Trust or faith in someone.'] },
  confirm: { p: 'v.', d: ['To establish the truth or correctness of.'] },
  conflict: { p: 'n./v.', d: ['A serious disagreement or argument.', 'To be incompatible.'] },
  congress: { p: 'n.', d: ['A formal meeting of delegates.', 'The US legislature.'] },
  connect: { p: 'v.', d: ['To join or link together.'] },
  consequence: { p: 'n.', d: ['A result or effect of an action.'] },
  conservative: { p: 'adj.', d: ['Averse to change; holding traditional values.'] },
  consider: { p: 'v.', d: ['To think carefully about.'] },
  consistent: { p: 'adj.', d: ['Acting in the same way over time; compatible.'] },
  construct: { p: 'v.', d: ['To build or form by putting parts together.'] },
  consumer: { p: 'n.', d: ['A person who purchases goods and services.'] },
  contact: { p: 'n./v.', d: ['The state of physical touching.', 'To get in touch with.'] },
  contain: { p: 'v.', d: ['To have or hold within.', 'To control or restrain.'] },
  contemporary: { p: 'adj.', d: ['Living or occurring at the same time; modern.'] },
  contest: { p: 'n./v.', d: ['A competition.', 'To oppose or challenge.'] },
  context: { p: 'n.', d: ['The circumstances that form the setting for an event.'] },
  contract: { p: 'n./v.', d: ['A written agreement.', 'To decrease in size; to catch (illness).'] },
  contrast: { p: 'n./v.', d: ['The state of being strikingly different.', 'To compare.'] },
  contribute: { p: 'v.', d: ['To give in order to help achieve something.'] },
  convention: { p: 'n.', d: ['A way in which something is usually done.', 'A large meeting.'] },
  convince: { p: 'v.', d: ['To cause someone to believe firmly in something.'] },
  council: { p: 'n.', d: ['An advisory or administrative body of people.'] },
  counsel: { p: 'n./v.', d: ['Advice or guidance.', 'To give advice to.'] },
  courage: { p: 'n.', d: ['The ability to face fear or danger.'] },
  creation: { p: 'n.', d: ['The action of bringing something into existence.'] },
  criminal: { p: 'adj./n.', d: ['Relating to crime.', 'A person who has committed a crime.'] },
  criterion: { p: 'n.', d: ['A standard by which something may be judged.'] },
  criticism: { p: 'n.', d: ['The expression of disapproval.', 'The analysis of literary work.'] },
  crucial: { p: 'adj.', d: ['Of decisive or critical importance.'] },
  curiosity: { p: 'n.', d: ['A strong desire to know or learn something.'] },
  currency: { p: 'n.', d: ['A system of money in general use.'] },
  curriculum: { p: 'n.', d: ['The subjects making up a course of study.'] },
  darkness: { p: 'n.', d: ['The absence of light.'] },
  database: { p: 'n.', d: ['A structured set of data held in a computer.'] },
  deadline: { p: 'n.', d: ['The latest time by which something must be completed.'] },
  debate: { p: 'n./v.', d: ['A formal discussion on a particular topic.', 'To argue about.'] },
  decade: { p: 'n.', d: ['A period of ten years.'] },
  decline: { p: 'v./n.', d: ['To become smaller or weaker.', 'A gradual loss of strength.'] },
  defendant: { p: 'n.', d: ['An individual being accused in a court of law.'] },
  deficit: { p: 'n.', d: ['The amount by which something falls short.'] },
  definition: { p: 'n.', d: ['A statement of the exact meaning of a word.'] },
  deliver: { p: 'v.', d: ['To bring and give to the intended recipient.'] },
  democracy: { p: 'n.', d: ['A system of government by the whole population.'] },
  demonstrate: { p: 'v.', d: ['To show clearly and deliberately.', 'To take part in a public protest.'] },
  deny: { p: 'v.', d: ['To state that something is not true; to refuse.'] },
  department: { p: 'n.', d: ['A division of a large organization.'] },
  depression: { p: 'n.', d: ['A severe downturn in mood or the economy.'] },
  derive: { p: 'v.', d: ['To obtain something from a specified source.'] },
  describe: { p: 'v.', d: ['To give an account in words.'] },
  despite: { p: 'prep.', d: ['Without being affected by; in spite of.'] },
  destroy: { p: 'v.', d: ['To cause something to cease to exist.'] },
  determine: { p: 'v.', d: ['To cause a decision to be made; to ascertain.'] },
  dimension: { p: 'n.', d: ['A measurable extent such as length, height, or width.'] },
  director: { p: 'n.', d: ['A person who is in charge of an activity or organization.'] },
  discipline: { p: 'n./v.', d: ['The practice of training to obey rules.', 'To punish or train.'] },
  discovery: { p: 'n.', d: ['The action of finding something unexpectedly.'] },
  dismiss: { p: 'v.', d: ['To send away; to remove from employment.', 'To reject.'] },
  disorder: { p: 'n.', d: ['A state of confusion or disruption.'] },
  display: { p: 'v./n.', d: ['To show or exhibit.', 'A performance or exhibition.'] },
  distinction: { p: 'n.', d: ['A difference between similar things.', 'Excellence.'] },
  distribution: { p: 'n.', d: ['The action of sharing something among recipients.'] },
  district: { p: 'n.', d: ['An area of a country or city.'] },
  domestic: { p: 'adj.', d: ['Relating to the home or one\'s own country.'] },
  dominate: { p: 'v.', d: ['To have a commanding influence over.'] },
  earnings: { p: 'n.', d: ['Money obtained in return for labor or services.'] },
  economy: { p: 'n.', d: ['The state of a region in terms of production and consumption.'] },
  edition: { p: 'n.', d: ['A particular version of a published text.'] },
  efficiency: { p: 'n.', d: ['The state of achieving maximum productivity.'] },
  element: { p: 'n.', d: ['A basic or essential part of something.', 'A chemical substance.'] },
  eliminate: { p: 'v.', d: ['To completely remove or get rid of.'] },
  embrace: { p: 'v./n.', d: ['To hold closely in one\'s arms.', 'An act of embracing.'] },
  emerge: { p: 'v.', d: ['To come into view; to become known.'] },
  emission: { p: 'n.', d: ['The production and discharge of something.'] },
  emphasis: { p: 'n.', d: ['Special importance or stress given to something.'] },
  empire: { p: 'n.', d: ['An extensive group of states ruled by one authority.'] },
  employment: { p: 'n.', d: ['The condition of having paid work.'] },
  enable: { p: 'v.', d: ['To make able or possible.'] },
  encourage: { p: 'v.', d: ['To give support, confidence, or hope.'] },
  enhance: { p: 'v.', d: ['To increase or improve in value or quality.'] },
  enormous: { p: 'adj.', d: ['Very large in size or extent.'] },
  enterprise: { p: 'n.', d: ['A business or company.', 'A bold undertaking.'] },
  entirely: { p: 'adv.', d: ['Completely; fully.'] },
  episode: { p: 'n.', d: ['An event or a group of events; one part of a series.'] },
  establish: { p: 'v.', d: ['To set up on a firm or permanent basis.'] },
  evaluate: { p: 'v.', d: ['To form an idea of the amount or value of.'] },
  evolution: { p: 'n.', d: ['The gradual development of something.', 'Biological change over time.'] },
  exception: { p: 'n.', d: ['A person or thing that is excluded from a rule.'] },
  exchange: { p: 'n./v.', d: ['The act of giving one thing for another.', 'To trade.'] },
  executive: { p: 'adj./n.', d: ['Having the power to put plans into effect.', 'A senior manager.'] },
  exhibit: { p: 'v./n.', d: ['To display publicly.', 'An object on display.'] },
  experiment: { p: 'n./v.', d: ['A test to discover something.', 'To perform a test.'] },
  explanation: { p: 'n.', d: ['A statement that makes something clear.'] },
  exploit: { p: 'v./n.', d: ['To make use of selfishly.', 'A bold adventure.'] },
  extend: { p: 'v.', d: ['To make longer or larger; to stretch out.'] },
  facility: { p: 'n.', d: ['A place or building used for a particular purpose.', 'Ease of use.'] },
  faculty: { p: 'n.', d: ['The teaching staff of a university.', 'An inherent mental power.'] },
  faithful: { p: 'adj.', d: ['Loyal and steadfast.'] },
  fashion: { p: 'n.', d: ['A popular trend in clothing or style.', 'A manner of doing.'] },
  feature: { p: 'n./v.', d: ['A distinctive attribute.', 'To give prominence to.'] },
  federal: { p: 'adj.', d: ['Relating to a system of government with central and regional units.'] },
  fiction: { p: 'n.', d: ['Literature from imagination, not based on fact.'] },
  finance: { p: 'n./v.', d: ['The management of money.', 'To provide funding.'] },
  finding: { p: 'n.', d: ['A conclusion reached after examination.'] },
  formula: { p: 'n.', d: ['A mathematical relationship expressed in symbols.', 'A fixed method.'] },
  fortune: { p: 'n.', d: ['Chance as a force affecting human affairs.', 'A large sum of money.'] },
  foundation: { p: 'n.', d: ['The base on which something stands.', 'An organization set up to fund causes.'] },
  freedom: { p: 'n.', d: ['The power to act without restriction.'] },
  frequency: { p: 'n.', d: ['The rate at which something occurs.'] },
  generate: { p: 'v.', d: ['To produce or create.'] },
  governor: { p: 'n.', d: ['The elected head of a US state.', 'A person who governs.'] },
  guarantee: { p: 'n./v.', d: ['A formal promise or assurance.', 'To promise with certainty.'] },
  guideline: { p: 'n.', d: ['A general rule or piece of advice.'] },
  horizon: { p: 'n.', d: ['The line where the earth seems to meet the sky.', 'The limit of knowledge.'] },
  household: { p: 'n.', d: ['A house and its occupants as a unit.'] },
  identical: { p: 'adj.', d: ['Exactly the same.'] },
  illustrate: { p: 'v.', d: ['To explain by giving examples or pictures.'] },
  implement: { p: 'v./n.', d: ['To put into effect.', 'A tool or utensil.'] },
  implication: { p: 'n.', d: ['The conclusion that can be drawn from something.'] },
  impose: { p: 'v.', d: ['To force something to be accepted.', 'To take advantage of.'] },
  impulse: { p: 'n.', d: ['A sudden strong urge to act.'] },
  incident: { p: 'n.', d: ['An event or occurrence, often unexpected.'] },
  incorporate: { p: 'v.', d: ['To include as part of a whole.', 'To form a legal corporation.'] },
  increasingly: { p: 'adv.', d: ['To an increasing extent; more and more.'] },
  independence: { p: 'n.', d: ['The state of being free from outside control.'] },
  inflation: { p: 'n.', d: ['A general increase in prices.', 'The act of filling with air.'] },
  influence: { p: 'n./v.', d: ['The capacity to have an effect on someone.', 'To affect.'] },
  initiative: { p: 'n.', d: ['The ability to act independently.', 'A new plan or strategy.'] },
  innovation: { p: 'n.', d: ['The introduction of new ideas or methods.'] },
  inspection: { p: 'n.', d: ['Careful examination or scrutiny.'] },
  institution: { p: 'n.', d: ['An organization founded for a particular purpose.', 'An established custom.'] },
  intellectual: { p: 'adj./n.', d: ['Relating to the intellect.', 'A person of intellect.'] },
  intelligent: { p: 'adj.', d: ['Having the ability to think and understand.'] },
  intention: { p: 'n.', d: ['A plan; something one intends to do.'] },
  interpret: { p: 'v.', d: ['To explain the meaning of.', 'To translate orally.'] },
  investment: { p: 'n.', d: ['The act of putting money into something for profit.'] },
  journalist: { p: 'n.', d: ['A person who writes for newspapers or broadcasts news.'] },
  jurisdiction: { p: 'n.', d: ['The official power to make legal decisions.'] },
  legislation: { p: 'n.', d: ['Laws considered collectively.'] },
  liberal: { p: 'adj.', d: ['Open to new ideas; favoring individual liberty.'] },
  literally: { p: 'adv.', d: ['In a literal sense; exactly as stated.', 'Used for emphasis.'] },
  mainland: { p: 'n.', d: ['The main part of a country, excluding islands.'] },
  maintenance: { p: 'n.', d: ['The process of keeping something in good condition.'] },
  majority: { p: 'n.', d: ['The greater number; more than half.'] },
  manufacture: { p: 'v./n.', d: ['To make on a large scale with machinery.', 'The process of manufacturing.'] },
  meanwhile: { p: 'adv.', d: ['In the intervening period of time.'] },
  mechanism: { p: 'n.', d: ['A system of parts working together in a machine.'] },
  narrative: { p: 'n./adj.', d: ['A spoken or written account of events.', 'In the form of a story.'] },
  negotiate: { p: 'v.', d: ['To try to reach an agreement through discussion.'] },
  nevertheless: { p: 'adv.', d: ['In spite of that; nonetheless.'] },
  objective: { p: 'n./adj.', d: ['A goal aimed for.', 'Not influenced by personal feelings.'] },
  obligation: { p: 'n.', d: ['A duty or commitment.', 'A legal requirement.'] },
  observation: { p: 'n.', d: ['The action of watching something carefully.', 'A remark.'] },
  obviously: { p: 'adv.', d: ['In a way that is easily perceived; clearly.'] },
  opponent: { p: 'n.', d: ['A person who competes against or opposes another.'] },
  organic: { p: 'adj.', d: ['Produced without artificial chemicals.', 'Relating to living organisms.'] },
  otherwise: { p: 'adv.', d: ['In other respects; apart from that.', 'Under different circumstances.'] },
  outcome: { p: 'n.', d: ['The result or consequence of an action.'] },
  overcome: { p: 'v.', d: ['To succeed in dealing with a problem.'] },
  participant: { p: 'n.', d: ['A person who takes part in something.'] },
  perception: { p: 'n.', d: ['The ability to perceive through the senses.', 'A way of understanding.'] },
  phenomenon: { p: 'n.', d: ['A fact or event that can be observed.'] },
  pollution: { p: 'n.', d: ['The presence of harmful substances in the environment.'] },
  portfolio: { p: 'n.', d: ['A collection of work or investments.'] },
  potential: { p: 'adj./n.', d: ['Having the capacity to develop.', 'Latent qualities.'] },
  precisely: { p: 'adv.', d: ['In exact terms; exactly.'] },
  preference: { p: 'n.', d: ['A greater liking for one alternative over another.'] },
  premier: { p: 'adj./n.', d: ['First in importance.', 'A head of government.'] },
  presume: { p: 'v.', d: ['To suppose something is true without proof.'] },
  previously: { p: 'adv.', d: ['At a previous or earlier time.'] },
  principle: { p: 'n.', d: ['A fundamental truth serving as the foundation for belief.'] },
  priority: { p: 'n.', d: ['The fact of being treated as more important.'] },
  procedure: { p: 'n.', d: ['An established way of doing something.'] },
  professor: { p: 'n.', d: ['A university academic of the highest rank.'] },
  profile: { p: 'n.', d: ['An outline of something.', 'A short description of a person.'] },
  proportion: { p: 'n.', d: ['A part or share of a whole.', 'The relationship between things.'] },
  provision: { p: 'n.', d: ['The act of providing or supplying.', 'A clause in a legal document.'] },
  psychological: { p: 'adj.', d: ['Relating to the mind or mental processes.'] },
  publisher: { p: 'n.', d: ['A company or person that prepares and issues books.'] },
  radical: { p: 'adj.', d: ['Relating to the fundamental nature of something.', 'Extreme.'] },
  realm: { p: 'n.', d: ['A kingdom.', 'A field or domain of activity.'] },
  recession: { p: 'n.', d: ['A period of temporary economic decline.'] },
  recognition: { p: 'n.', d: ['The action of identifying or acknowledging.'] },
  regime: { p: 'n.', d: ['A system of government.', 'An ordered way of doing things.'] },
  regional: { p: 'adj.', d: ['Relating to a region or area.'] },
  relatively: { p: 'adv.', d: ['In relation or proportion to something else.'] },
  remote: { p: 'adj.', d: ['Far away in distance or time.', 'Isolated.'] },
  reputation: { p: 'n.', d: ['The beliefs held about someone or something.'] },
  requirement: { p: 'n.', d: ['A thing that is needed or demanded.'] },
  resolution: { p: 'n.', d: ['A firm decision.', 'The action of solving a problem.'] },
  restore: { p: 'v.', d: ['To bring back to a former condition.'] },
  revenue: { p: 'n.', d: ['Income generated from business activities.'] },
  revolution: { p: 'n.', d: ['A forcible overthrow of a government.', 'A dramatic change.'] },
  sanction: { p: 'n./v.', d: ['A penalty for breaking a law.', 'To authorize officially.'] },
  scenario: { p: 'n.', d: ['A possible sequence of events.'] },
  scholar: { p: 'n.', d: ['A person who is highly educated in a field.'] },
  sector: { p: 'n.', d: ['An area or portion of something.', 'An economic division.'] },
  seminar: { p: 'n.', d: ['A small conference or class for discussion.'] },
  senator: { p: 'n.', d: ['A member of a senate.'] },
  sensitivity: { p: 'n.', d: ['The quality of being sensitive.'] },
  subsequent: { p: 'adj.', d: ['Coming after something in time.'] },
  substantially: { p: 'adv.', d: ['To a great or significant extent.'] },
  sufficient: { p: 'adj.', d: ['Enough; adequate.'] },
  surrender: { p: 'v.', d: ['To stop resisting and submit to authority.'] },
  suspect: { p: 'v./n.', d: ['To believe something is possible.', 'A person under suspicion.'] },
  symbol: { p: 'n.', d: ['A thing that represents or stands for something else.'] },
  symptom: { p: 'n.', d: ['A physical or mental feature indicating a condition.'] },
  target: { p: 'n./v.', d: ['A person or thing aimed at.', 'To select as an object of attack.'] },
  technique: { p: 'n.', d: ['A way of carrying out a particular task.'] },
  territory: { p: 'n.', d: ['An area of land under a particular jurisdiction.'] },
  terrorism: { p: 'n.', d: ['The use of violence for political aims.'] },
  testimony: { p: 'n.', d: ['A formal statement given as evidence.'] },
  therefore: { p: 'adv.', d: ['For that reason; consequently.'] },
  tournament: { p: 'n.', d: ['A series of contests between competitors.'] },
  transformation: { p: 'n.', d: ['A thorough or dramatic change in form.'] },
  tremendous: { p: 'adj.', d: ['Very great in amount or intensity.', 'Extremely good.'] },
  ultimately: { p: 'adv.', d: ['Finally; in the end.'] },
  underlying: { p: 'adj.', d: ['Fundamental; lying beneath the surface.'] },
  universal: { p: 'adj.', d: ['Relating to all people or things in the world.'] },
  variation: { p: 'n.', d: ['A change or difference in condition or amount.'] },
  virtually: { p: 'adv.', d: ['Nearly; almost.', 'By means of computer technology.'] },
  volunteer: { p: 'n./v.', d: ['A person who freely offers to do something.', 'To offer freely.'] },
  whereas: { p: 'conj.', d: ['In contrast or comparison with the fact that.'] },
  withdraw: { p: 'v.', d: ['To remove or take away.', 'To leave or retreat.'] },
  witness: { p: 'n./v.', d: ['A person who sees an event occur.', 'To see an event happen.'] },
};

/** 从 Free Dictionary phonetics 里识别 UK/US（按音频 URL 后缀，不靠数组下标） */
function pickPhonetics(
  phonetics: Array<{ text?: string; audio?: string }>,
  fallback?: string,
): Pick<WordDefinition, 'phoneticUK' | 'phoneticUS' | 'audioUK' | 'audioUS'> {
  let phoneticUK = '';
  let phoneticUS = '';
  let audioUK = '';
  let audioUS = '';
  const otherAudio: string[] = [];

  for (const p of phonetics) {
    const text = (p.text ?? '').trim();
    const audio = (p.audio ?? '').trim();
    const tag = audio.toLowerCase();

    if (/-uk([.-]|$)/.test(tag) || tag.includes('_uk')) {
      if (audio) audioUK = audio;
      if (text) phoneticUK = text;
    } else if (/-us([.-]|$)/.test(tag) || tag.includes('_us')) {
      if (audio) audioUS = audio;
      if (text) phoneticUS = text;
    } else {
      if (text && !phoneticUK) phoneticUK = text;
      else if (text && text !== phoneticUK && !phoneticUS) phoneticUS = text;
      if (audio) otherAudio.push(audio);
    }
  }

  // 无地区标签的音频: 依次补到空位
  for (const audio of otherAudio) {
    if (!audioUK) audioUK = audio;
    else if (!audioUS && audio !== audioUK) audioUS = audio;
  }

  if (!phoneticUK && !phoneticUS) phoneticUK = (fallback ?? '').trim();
  if (!phoneticUK) phoneticUK = phoneticUS;
  if (!phoneticUS) phoneticUS = phoneticUK;

  return {
    phoneticUK: phoneticUK || undefined,
    phoneticUS: phoneticUS || undefined,
    audioUK: audioUK || undefined,
    audioUS: audioUS || undefined,
  };
}

// ---- 服务 ----

export class DictionaryService {
  private localDict: Record<string, CompactEntry> | null = null;
  private fullDictPromise: Promise<Record<string, CompactEntry>> | null = null;
  /** 查词缓存: 查过的词下次秒出 */
  private cache = new Map<string, WordDefinition>();

  constructor() {
    // 扩展启动时预加载本地词典(13MB), 这样点击单词时不用等
    this.warmup();
  }

  /** 后台预加载完整词典, 不阻塞任何请求 */
  private warmup(): void {
    this.loadFullDict().then((d) => {
      if (d && Object.keys(d).length > 0) {
        log.info('词典预热完成:', Object.keys(d).length, '词');
      }
    });
  }

  private remember(word: string, result: WordDefinition): void {
    if (this.cache.size >= 500) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(word, result);
  }

  async lookup(word: string): Promise<WordDefinition | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    const cached = this.cache.get(clean);
    if (cached) return cached;

    // 每次先试在线(经 SW 代理); 失败再本地。不再永久锁 local。
    const online = await this.onlineLookup(clean);
    if (online) {
      this.remember(clean, online);
      return online;
    }

    const local = await this.localLookup(clean);
    if (local) this.remember(clean, local);
    return local;
  }

  // ---- 内部 ----

  private async onlineLookup(word: string): Promise<WordDefinition | null> {
    try {
      const resp = await safeFetch(
        `${ONLINE_API}/${encodeURIComponent(word)}`,
        { timeoutMs: ONLINE_TIMEOUT_MS },
      );
      if (!resp) return null;

      const data = (await resp.json()) as DictApiEntry[];
      const entry = data?.[0];
      if (!entry) return null;

      const picked = pickPhonetics(entry.phonetics ?? [], entry.phonetic);

      return {
        word: entry.word,
        phonetic: entry.phonetic,
        ...picked,
        meanings: (entry.meanings ?? []).map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: m.definitions.map((d) => ({
            definition: d.definition,
            example: d.example,
          })),
        })),
      };
    } catch (err) {
      log.debug('online lookup error:', (err as Error).message);
      return null;
    }
  }

  private async localLookup(word: string): Promise<WordDefinition | null> {
    // 先查 mini 词典
    const mini = MINI_DICT[word];
    if (mini) return this.expandCompact(word, mini);

    // 尝试加载完整本地词典
    const full = await this.loadFullDict();
    const entry = full?.[word];
    if (entry) return this.expandCompact(word, entry);

    return null;
  }

  /** 将压缩格式展开为完整 WordDefinition */
  private expandCompact(word: string, entry: CompactEntry): WordDefinition {
    return {
      word,
      meanings: [{
        partOfSpeech: entry.p ?? '',
        definitions: entry.d.map((d) => ({ definition: d })),
      }],
    };
  }

  /** 动态加载完整本地词典(dict.json, 由 build-dict.py 生成) */
  private async loadFullDict(): Promise<Record<string, CompactEntry> | null> {
    if (this.fullDictPromise) return this.fullDictPromise;
    if (this.localDict) return this.localDict;

    this.fullDictPromise = (async () => {
      try {
        const url = chrome.runtime.getURL('dict.json');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const dict = (await resp.json()) as Record<string, CompactEntry>;
        this.localDict = dict;
        log.info('完整本地词典已加载:', Object.keys(dict).length, '词');
        return dict;
      } catch (err) {
        log.debug('完整本地词典不可用(运行 build-dict.py 生成):', (err as Error).message);
        this.localDict = {}; // 防止重复尝试
        return {};
      }
    })();

    return this.fullDictPromise;
  }
}
