// Assistant metadata (icons are resolved in frontend components)
export const ASSISTANTS = [
  {
    key: 'legal',
    label: 'Legal Assistant',
    iconName: 'Scale',
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Legal Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Due diligence', iconName: 'FileSearch', message: 'I want help with due diligence' },
      { label: 'Contract analysis', iconName: 'FileText', message: 'I want help with contract analysis' },
      { label: 'Compliance lookup', iconName: 'ShieldCheck', message: 'I want help with compliance lookup' },
    ],
  },
  {
    key: 'teaching',
    label: 'Teaching Assistant',
    iconName: 'GraduationCap',
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Teaching Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Curriculum doubt solving', iconName: 'BookOpen', message: 'I want help with curriculum doubt solving' },
      { label: 'Lesson plan creation', iconName: 'PenLine', message: 'I want help with lesson plan creation' },
      { label: 'Exam preparation', iconName: 'ClipboardList', message: 'I want help with exam preparation' },
    ],
  },
  {
    key: 'employee',
    label: 'Employee Assistant',
    iconName: 'Briefcase',
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Employee Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'HR policy support', iconName: 'Users', message: 'I want help with HR policy support' },
      { label: 'Employee onboarding', iconName: 'UserPlus', message: 'I want help with employee onboarding' },
      { label: 'IT helpdesk guidance', iconName: 'Monitor', message: 'I want help with IT helpdesk guidance' },
    ],
  },
  {
    key: 'customer',
    label: 'Customer Assistant',
    iconName: 'Headset',
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Customer Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Product discovery', iconName: 'Package', message: 'I want help with product discovery' },
      { label: 'Issue troubleshooting', iconName: 'Wrench', message: 'I want help with issue troubleshooting' },
      { label: 'Policy clarification', iconName: 'Info', message: 'I want help with policy clarification' },
    ],
  },
  {
    key: 'banking',
    label: 'Banking & Insurance',
    iconName: 'Landmark',
    mode: 'doc',
    voice: true,
    welcomeMessage: 'Private, enterprise-grade Banking & Insurance Assistant running on our local server. Try the sample use cases below. If this fits your workflow, we can also build and deploy a secure on-premise version using your own data and infrastructure.',
    tryOptions: [
      { label: 'Policy lookup', iconName: 'FileSearch', message: 'I want help with policy and product lookup' },
      { label: 'Claims guidance', iconName: 'ClipboardCheck', message: 'I want help with claims and service guidance' },
      { label: 'Compliance support', iconName: 'ShieldCheck', message: 'I want help with compliance and regulatory support' },
    ],
  },
];
