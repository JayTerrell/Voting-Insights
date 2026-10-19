// Which offices on a Texas ballot shape each issue area, and why. Written by
// hand from each office's powers (data/offices.json) so every link has a plain
// reason. Offices are listed with the most direct influence first.
//
// Office keys match race.office_key in the guide. The intermediate courts of
// appeals (coa, coa5, coa15) share the key "coa".

export const OFFICE_NAMES = {
  us_senate: 'U.S. Senator',
  us_house: 'U.S. Representative',
  governor: 'Governor',
  lt_governor: 'Lieutenant Governor',
  attorney_general: 'Attorney General',
  comptroller: 'Comptroller',
  land_commissioner: 'Land Commissioner',
  agriculture_commissioner: 'Agriculture Commissioner',
  railroad_commissioner: 'Railroad Commissioner',
  supreme_court: 'Texas Supreme Court',
  cca: 'Court of Criminal Appeals',
  coa: 'Court of Appeals',
  state_senate: 'Texas Senate',
  state_house: 'Texas House',
  sboe: 'State Board of Education',
  district_court: 'District Judge',
  ccl: 'County Court at Law Judge',
  jp: 'Justice of the Peace',
  district_attorney: 'District Attorney',
  county_attorney: 'County Attorney',
  county_judge: 'County Judge',
  county_commissioner: 'County Commissioner',
  sheriff: 'Sheriff',
  constable: 'Constable',
  tax_assessor: 'Tax Assessor-Collector',
  county_clerk: 'County Clerk',
  county_ed_board: 'County Board of Education',
};

export const officeGroup = (key) => (key === 'coa5' || key === 'coa15' ? 'coa' : key);

export const ISSUE_OFFICES = {
  Abortion: [
    ['state_house', 'Writes Texas abortion law, including the current ban and its exceptions.'],
    ['state_senate', 'Writes Texas abortion law, including the current ban and its exceptions.'],
    ['us_senate', 'Votes on national abortion bills and confirms federal judges.'],
    ['us_house', 'Votes on national abortion bills and federal health funding.'],
    ['attorney_general', 'Enforces and defends state abortion laws in court.'],
    ['governor', 'Signs or vetoes abortion bills.'],
    ['supreme_court', 'Rules on how state abortion laws and their medical exceptions apply.'],
    ['district_attorney', 'Decides whether to bring criminal cases under abortion laws.'],
  ],
  'County Government': [
    ['county_judge', 'Leads the Commissioners Court, which sets the county budget and tax rate.'],
    ['county_commissioner', 'Votes on the county budget, roads, and property tax rate.'],
    ['tax_assessor', 'Collects property taxes and, in many counties, registers voters.'],
    ['county_clerk', 'Keeps property and court records, and runs elections in some counties.'],
    ['sheriff', 'Runs the county jail, one of the largest items in most county budgets.'],
  ],
  Courts: [
    ['supreme_court', 'Has the final word on civil cases and how Texas law is read.'],
    ['cca', 'Has the final word on criminal cases, including death penalty appeals.'],
    ['coa', 'Hears most appeals from trial courts in its region.'],
    ['district_court', 'Tries felonies, divorces and custody cases, and major lawsuits.'],
    ['ccl', 'Hears misdemeanors and smaller civil cases.'],
    ['jp', 'Handles evictions, small claims, and traffic tickets.'],
    ['us_senate', 'Confirms federal judges, including U.S. Supreme Court justices.'],
    ['governor', 'Appoints judges to fill vacancies until the next election.'],
  ],
  Education: [
    ['sboe', 'Sets what students learn and approves instructional materials.'],
    ['state_house', 'Writes school funding formulas and education laws, including school choice.'],
    ['state_senate', 'Writes school funding formulas and education laws, including school choice.'],
    ['lt_governor', 'Decides which education bills reach a vote in the Senate.'],
    ['governor', 'Signs or vetoes the school budget and education bills.'],
    ['us_house', 'Votes on federal education funding and student loan rules.'],
    ['us_senate', 'Votes on federal education funding and student loan rules.'],
    ['county_ed_board', 'Oversees county education services in Harris County.'],
  ],
  'Elections and Ethics': [
    ['state_house', 'Writes voting rules: photo ID, mail ballots, and early voting hours.'],
    ['state_senate', 'Writes voting rules: photo ID, mail ballots, and early voting hours.'],
    ['attorney_general', 'Investigates and prosecutes election law violations.'],
    ['governor', 'Signs or vetoes election bills and calls special elections.'],
    ['us_house', 'Votes on federal election and campaign finance law.'],
    ['us_senate', 'Votes on federal election and campaign finance law.'],
    ['tax_assessor', 'Registers voters in many counties.'],
    ['county_clerk', 'Runs elections in some counties.'],
  ],
  'Energy and Environment': [
    ['railroad_commissioner', 'Regulates oil and gas drilling, pipelines, and well cleanup.'],
    ['state_house', 'Writes laws on the power grid, water, and pollution.'],
    ['state_senate', 'Writes laws on the power grid, water, and pollution.'],
    ['governor', 'Appoints the leaders of the utility and environmental agencies.'],
    ['land_commissioner', 'Manages state lands, energy leases, and coastal protection.'],
    ['us_house', 'Votes on federal energy and environmental law.'],
    ['us_senate', 'Votes on federal energy and environmental law.'],
  ],
  'Family and Social Policy': [
    ['state_house', 'Writes family law and funds child welfare and social programs.'],
    ['state_senate', 'Writes family law and funds child welfare and social programs.'],
    ['district_court', 'Decides divorces, custody, adoptions, and child protection cases.'],
    ['governor', 'Signs or vetoes family policy bills and appoints agency leaders.'],
    ['attorney_general', 'Runs the state child support program.'],
    ['us_house', 'Votes on federal family and social programs.'],
    ['us_senate', 'Votes on federal family and social programs.'],
  ],
  'Guns and Public Safety': [
    ['state_house', 'Writes state gun and criminal laws, and bail rules.'],
    ['state_senate', 'Writes state gun and criminal laws, and bail rules.'],
    ['district_attorney', 'Decides which crimes to prosecute and what sentences to seek.'],
    ['sheriff', 'Runs the county jail and patrols areas outside city limits.'],
    ['us_house', 'Votes on federal gun laws.'],
    ['us_senate', 'Votes on federal gun laws.'],
    ['governor', 'Oversees state public safety agencies and signs criminal justice bills.'],
    ['district_court', 'Sets bail and sentences in felony cases.'],
    ['county_commissioner', 'Funds the sheriff, jail, and county law enforcement.'],
  ],
  'Health Care': [
    ['state_house', 'Writes Medicaid and health insurance rules for Texas.'],
    ['state_senate', 'Writes Medicaid and health insurance rules for Texas.'],
    ['us_house', 'Votes on Medicare, federal Medicaid funding, and health insurance law.'],
    ['us_senate', 'Votes on Medicare, federal Medicaid funding, and health insurance law.'],
    ['governor', 'Signs or vetoes health bills and appoints the health agency leader.'],
    ['county_commissioner', 'Funds county public health and care for uninsured residents.'],
    ['county_judge', 'Leads the county budget for public health and indigent care.'],
  ],
  'Immigration and Border': [
    ['us_house', 'Writes federal immigration law.'],
    ['us_senate', 'Writes federal immigration law and confirms immigration officials.'],
    ['governor', 'Directs state border security operations.'],
    ['state_house', 'Funds state border security and writes state immigration laws.'],
    ['state_senate', 'Funds state border security and writes state immigration laws.'],
    ['attorney_general', 'Sues over federal immigration policy and defends state border laws.'],
    ['sheriff', 'Runs the county jail, which handles federal immigration holds.'],
  ],
  'Jobs and Wages': [
    ['state_house', 'Writes state business, licensing, and labor laws.'],
    ['state_senate', 'Writes state business, licensing, and labor laws.'],
    ['us_house', 'Votes on the federal minimum wage, trade, and labor law.'],
    ['us_senate', 'Votes on the federal minimum wage, trade, and labor law.'],
    ['governor', 'Leads the state economic development and job incentive programs.'],
    ['comptroller', 'Forecasts the economy and runs some business incentive programs.'],
  ],
  'Land and Agriculture': [
    ['agriculture_commissioner', 'Regulates pesticides, scales, and fuel pumps, and supports farmers.'],
    ['land_commissioner', 'Manages state lands, the Alamo, and disaster recovery housing.'],
    ['railroad_commissioner', 'Regulates drilling and pipelines on private and public land.'],
    ['state_house', 'Writes water, property rights, and eminent domain laws.'],
    ['state_senate', 'Writes water, property rights, and eminent domain laws.'],
    ['us_house', 'Votes on the federal farm bill.'],
    ['us_senate', 'Votes on the federal farm bill.'],
    ['county_commissioner', 'Maintains county roads and sets rules outside city limits.'],
  ],
  'Taxes and Spending': [
    ['state_house', 'Writes the state budget and property tax relief.'],
    ['state_senate', 'Writes the state budget and property tax relief.'],
    ['comptroller', 'Collects state taxes and certifies that the budget balances.'],
    ['lt_governor', 'Sets the Senate budget priorities.'],
    ['governor', 'Can veto individual lines in the state budget.'],
    ['county_commissioner', 'Sets the county property tax rate and budget.'],
    ['county_judge', 'Leads the county budget and tax rate decisions.'],
    ['us_house', 'Votes on federal taxes and spending.'],
    ['us_senate', 'Votes on federal taxes and spending.'],
    ['tax_assessor', 'Collects the property taxes that local governments set.'],
  ],
};

export const ISSUE_AREAS = Object.keys(ISSUE_OFFICES);

// Ranks offices for a list of issues (most important first). An office scores
// higher when it touches more of the voter's issues, when those issues rank
// higher, and when it is listed nearer the top for an issue.
export function rankOffices(issues) {
  const scores = new Map();
  issues.forEach((issue, rank) => {
    (ISSUE_OFFICES[issue] || []).forEach(([key, why], pos) => {
      const entry = scores.get(key) || { key, score: 0, reasons: [] };
      entry.score += (issues.length - rank) * (1 - pos * 0.06);
      entry.reasons.push({ issue, why });
      scores.set(key, entry);
    });
  });
  return [...scores.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
