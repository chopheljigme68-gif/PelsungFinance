/**
 * The approved FY 2026-2027 budget as issued — 51 activities across the
 * Secretariat, Operations & Partnerships, Alumni Engagement, Innovation Lab,
 * Strategic Flexibility Reserve and the cohort stipend provision.
 *
 * Seeded once, on an empty database. Later years are entered through the
 * Budget Activities screen.
 */
export type BudgetSeed = {
  id: number;
  category: string;
  financing: string;
  obc: string;
  activity: string;
  budgetType: "Current" | "Capital";
  approvedNu: number;
  brief: string;
};

export const budgetSeeds: BudgetSeed[] = [
  { id: 1, category: "Secretariat Services", financing: "HMS", obc: "01.01", activity: "Pay and Allowances", budgetType: "Current", approvedNu: 12004800, brief: "Details in the next sheet" },
  { id: 2, category: "Secretariat Services", financing: "HMS", obc: "11.01", activity: "Travel - In country", budgetType: "Current", approvedNu: 1000000, brief: "In-country movement for cohort delivery, partner follow-up and monitoring." },
  { id: 3, category: "Secretariat Services", financing: "HMS", obc: "12.01", activity: "Telephone bills and monthly internet bill", budgetType: "Current", approvedNu: 96000, brief: "Monthly rental charges for telephone and internet" },
  { id: 4, category: "Secretariat Services", financing: "HMS", obc: "12.03", activity: "Electric bill", budgetType: "Current", approvedNu: 36000, brief: "Monthly electric bills" },
  { id: 5, category: "Secretariat Services", financing: "HMS", obc: "13.01", activity: "Rent for office space", budgetType: "Current", approvedNu: 500000, brief: "33,000 for 12 months + GST" },
  { id: 6, category: "Secretariat Services", financing: "HMS", obc: "14.01", activity: "Office supplies", budgetType: "Current", approvedNu: 140000, brief: "Basic stationery and event consumables." },
  { id: 7, category: "Secretariat Services", financing: "HMS", obc: "54.01", activity: "Office furniture", budgetType: "Capital", approvedNu: 600000, brief: "Procurement for new furniture during the year" },
  { id: 8, category: "Secretariat Services", financing: "HMS", obc: "17.01", activity: "Advertisement", budgetType: "Current", approvedNu: 200000, brief: "Recruitment and public communications." },
  { id: 9, category: "Secretariat Services", financing: "HMS", obc: "17.08", activity: "In-country meetings and celebrations", budgetType: "Current", approvedNu: 2000000, brief: "Opening/closing ceremonies of cohort, tokha, excursion during immersion for 3 cohorts" },
  { id: 10, category: "Secretariat Services", financing: "HMS", obc: "18.01", activity: "ED's entertainment budget", budgetType: "Current", approvedNu: 100000, brief: "ED's entertainment budget for partners, team well-being, etc." },
  { id: 11, category: "Secretariat Services", financing: "HMS", obc: "54.03", activity: "Purchase of new laptops", budgetType: "Capital", approvedNu: 800000, brief: "Basic hardware renewal for Secretariat team." },
  { id: 12, category: "Secretariat Services", financing: "HMS", obc: "45.01", activity: "Upskilling of Secretariat and Innovation Lab members", budgetType: "Capital", approvedNu: 2000000, brief: "Training for Secretariat and Innovation Lab members." },
  { id: 13, category: "Secretariat Services", financing: "HMS", obc: "54.03", activity: "Purchase of Accounting Software", budgetType: "Capital", approvedNu: 100000, brief: "Purchase of accounting software to digitise the accounting transactions" },
  { id: 14, category: "Operations & Partnerships", financing: "HMS", obc: "14.01", activity: "Printing of name cards and lanyards", budgetType: "Current", approvedNu: 210000, brief: "Expenses for 3 cohorts, printing of lanyards for 3 cohorts" },
  { id: 15, category: "Operations & Partnerships", financing: "HMS", obc: "55.01", activity: "Cohort Recruitment & Immersion - non-stipend costs", budgetType: "Capital", approvedNu: 3000000, brief: "Non-stipend immersion activity costs include medical screening, purchase of drug kits, learning facilitators, travel of facilitators, etc. (1M/cohort)" },
  { id: 16, category: "Operations & Partnerships", financing: "HMS", obc: "45.02", activity: "Design and launch structured programmes", budgetType: "Capital", approvedNu: 200000, brief: "25 post-immersion programmes require design and implementation quality control." },
  { id: 17, category: "Operations & Partnerships", financing: "HMS", obc: "45.02", activity: "Professional Readiness Programme", budgetType: "Capital", approvedNu: 5000000, brief: "Resource persons, materials, venue/logistics and monitoring under the 25 post-immersion programmes" },
  { id: 18, category: "Operations & Partnerships", financing: "HMS", obc: "11.01", activity: "Map strategic partners across priority sectors", budgetType: "Current", approvedNu: 600000, brief: "Food, accommodation and venues for partnership mapping and discussions." },
  { id: 19, category: "Operations & Partnerships", financing: "HMS", obc: "17.08", activity: "Foreign partner consultations", budgetType: "Current", approvedNu: 2500000, brief: "Foreign partner engagement in Bhutan and follow-up with high-value partners abroad." },
  { id: 20, category: "Operations & Partnerships", financing: "HMS", obc: "17.08", activity: "Formalise partnerships through MoUs/LoAs", budgetType: "Current", approvedNu: 350000, brief: "Meetings, documentation and legal/administrative follow-up." },
  { id: 21, category: "Operations & Partnerships", financing: "HMS", obc: "17.08", activity: "Conduct Partner Roundtable Series", budgetType: "Current", approvedNu: 1200000, brief: "Domestic partner roundtables for collaborations, commitments and programme implementation." },
  { id: 22, category: "Operations & Partnerships", financing: "HMS", obc: "55.01", activity: "Establish Partner Conversion Scorecard", budgetType: "Capital", approvedNu: 500000, brief: "Engage an M&E expert for partnership monitoring and conversion." },
  { id: 23, category: "Operations & Partnerships", financing: "HMS", obc: "11.01", activity: "Track interviews, offers and referrals", budgetType: "Current", approvedNu: 1800000, brief: "Track placement and referrals of Pelsups after their immersion programme." },
  { id: 24, category: "Operations & Partnerships", financing: "HMS", obc: "55.01", activity: "Activities during Immersion programme", budgetType: "Capital", approvedNu: 1500000, brief: "Activities during the immersion programme for 3 cohorts" },
  { id: 25, category: "Operations & Partnerships", financing: "HMS", obc: "45.02", activity: "Design and launch mini-cohorts", budgetType: "Capital", approvedNu: 5000000, brief: "19 mini-cohorts, including travel and lodging for high-value partners." },
  { id: 26, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "55.01", activity: "Document continuation pathways for alumni", budgetType: "Capital", approvedNu: 500000, brief: "Documenting and regularly updating Pelsup progress." },
  { id: 27, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "17.08", activity: "General Alumni Engagement Sessions", budgetType: "Current", approvedNu: 1200000, brief: "12 structured sessions for alumni to learn, share and grow." },
  { id: 28, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "17.08", activity: "Young Professionals Network", budgetType: "Current", approvedNu: 400000, brief: "Establishment and quarterly sessions for a Young Professionals Network." },
  { id: 29, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "45.02", activity: "Alumni Ambassadors Programme", budgetType: "Capital", approvedNu: 660000, brief: "Zonal and sector-specific ambassadors to coordinate the alumni network." },
  { id: 30, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "55.01", activity: "Alumni Reactivation Campaign", budgetType: "Capital", approvedNu: 500000, brief: "Reactivate dormant alumni and reintegrate them into engagement activities." },
  { id: 31, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "45.02", activity: "Alumni Mentorship Framework", budgetType: "Capital", approvedNu: 300000, brief: "A structured system where experienced Pelsups mentor newer members." },
  { id: 32, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "52.04", activity: "Alumni Portal and Website Upgrade & Maintenance", budgetType: "Capital", approvedNu: 500000, brief: "Portal upkeep, dashboard integration, website maintenance and hosting." },
  { id: 33, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "17.08", activity: "Alumni-Partner Engagement", budgetType: "Current", approvedNu: 1000000, brief: "Help alumni engage with partners for networking and opportunities." },
  { id: 34, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "11.01", activity: "Advocacy and Awareness at RUB Colleges", budgetType: "Current", approvedNu: 1000000, brief: "Travel and advocacy events at tertiary RUB institutions." },
  { id: 35, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "18.01", activity: "Alumni Awards & Foundation Day", budgetType: "Current", approvedNu: 2000000, brief: "Recognise alumni, partners and stakeholders and inspire the next generation." },
  { id: 36, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "18.01", activity: "Pelsung Momentos & Gift Packages", budgetType: "Current", approvedNu: 2500000, brief: "Branding and engagement items, including T-shirts and pins for Pelsups." },
  { id: 37, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "54.03", activity: "2 mirrorless cameras (+lenses and tripods) for documentation of activities + sessions", budgetType: "Capital", approvedNu: 700000, brief: "Video documentation and report pre-production." },
  { id: 38, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "54.03", activity: "Microphones (3)", budgetType: "Capital", approvedNu: 60000, brief: "Video documentation and report pre-production." },
  { id: 39, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "12.01", activity: "Paid subscriptions for Adobe Suite, Canva Pro, and Claude Pro", budgetType: "Current", approvedNu: 60000, brief: "Communications and report post-production." },
  { id: 40, category: "Alumni Engagement & Outreach", financing: "HMS", obc: "54.03", activity: "Laptop for graphic design/video editing", budgetType: "Capital", approvedNu: 200000, brief: "Communications and report post-production." },
  { id: 41, category: "Innovation Lab", financing: "HMS", obc: "55.01", activity: "Mentors Programme", budgetType: "Capital", approvedNu: 2000000, brief: "Mentor visas, accommodation and local transport." },
  { id: 42, category: "Innovation Lab", financing: "Projects Revenue", obc: "01.01", activity: "Pay and Allowances", budgetType: "Current", approvedNu: 9680000, brief: "Details in the next sheet" },
  { id: 43, category: "Innovation Lab", financing: "Fundraised by Pelsung", obc: "54.01", activity: "Innovation Lab set-up", budgetType: "Capital", approvedNu: 30000000, brief: "Interior set-up and required technologies for the Innovation Lab." },
  { id: 44, category: "Innovation Lab", financing: "Fundraised by Pelsung", obc: "26.01", activity: "General provision for events, publication of business intelligence reports, etc", budgetType: "Current", approvedNu: 500000, brief: "Events and publication of business intelligence reports." },
  { id: 45, category: "Innovation Lab", financing: "Fundraised by Pelsung", obc: "55.01", activity: "Venture Launch Support", budgetType: "Capital", approvedNu: 500000, brief: "Registration, branding, market access and initial operations." },
  { id: 46, category: "Innovation Lab", financing: "Seed Support Facility", obc: "55.01", activity: "Prototyping Budget", budgetType: "Capital", approvedNu: 1500000, brief: "Prototype support for Pelsup business ventures." },
  { id: 47, category: "Innovation Lab", financing: "Fundraised by Pelsung", obc: "55.01", activity: "Pelsung Innovation Lab Events", budgetType: "Capital", approvedNu: 1000000, brief: "Events for Innovation Lab outputs, ventures and business intelligence reports." },
  { id: 48, category: "Strategic Flexibility Reserve", financing: "HMS", obc: "26.01", activity: "Project 108 Preparedness", budgetType: "Capital", approvedNu: 2000000, brief: "Mentors, coaches and preparatory workshops for Project 108." },
  { id: 49, category: "Strategic Flexibility Reserve", financing: "HMS", obc: "56.01", activity: "ED adaptive programme and partnership reserve", budgetType: "Current", approvedNu: 3000000, brief: "Board-approved flexibility for new ideas not budgeted elsewhere." },
  { id: 50, category: "Strategic Flexibility Reserve", financing: "HMS", obc: "26.01", activity: "Operational Contingency", budgetType: "Current", approvedNu: 500000, brief: "Documented contingency for emerging priorities." },
  { id: 51, category: "Stipend for Three Cohorts", financing: "HMS", obc: "5.01", activity: "Stipend (For 1,019 Pelsups)", budgetType: "Current", approvedNu: 76629000, brief: "Stipend budget for three cohorts." },
];
export const approvedBudgetNu = budgetSeeds.reduce((total, activity) => total + activity.approvedNu, 0);
