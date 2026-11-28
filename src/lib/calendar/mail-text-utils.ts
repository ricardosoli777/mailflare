// Words the server puts into calendar mail and answers. The interface catalogs are client text; these are
// sentences written into messages, so they only come in Portuguese and English.

const english = {
	invitation: (title: string) => `Invitation: ${title}`,
	invitationBody: (title: string) => `You are invited to ${title}.`,
	updated: (title: string) => `Updated invitation: ${title}`,
	updatedBody: (title: string) => `This event has been updated: ${title}.`,
	cancelled: (title: string) => `Cancelled: ${title}`,
	cancelledBody: (title: string) => `This event has been cancelled: ${title}.`,
	replySubject: { accepted: "Accepted", tentative: "Tentatively accepted", declined: "Declined", counter: "New time proposed" },
	replyVerb: { accepted: "accepted", tentative: "tentatively accepted", declined: "declined", counter: "proposed a new time for" },
	proposedTime: "Proposed time",
	tooManyAttempts: "Too many booking attempts. Try again in a minute.",
	missingDetails: "Enter your name, email, and a time.",
	invalidDetails: "Check the guest emails and meeting notes.",
	slotTaken: "That time is no longer available.",
	eventNotFound: "Booking event not found",
};

const portuguese: typeof english = {
	invitation: (title) => `Convite: ${title}`,
	invitationBody: (title) => `Você recebeu um convite para ${title}.`,
	updated: (title) => `Convite atualizado: ${title}`,
	updatedBody: (title) => `Este evento foi atualizado: ${title}.`,
	cancelled: (title) => `Cancelado: ${title}`,
	cancelledBody: (title) => `Este evento foi cancelado: ${title}.`,
	replySubject: { accepted: "Aceito", tentative: "Talvez", declined: "Recusado", counter: "Novo horário proposto" },
	replyVerb: { accepted: "aceitou o convite", tentative: "respondeu talvez ao convite", declined: "recusou o convite", counter: "propôs um novo horário para" },
	proposedTime: "Horário proposto",
	tooManyAttempts: "Muitas tentativas de agendamento. Tente novamente em um minuto.",
	missingDetails: "Informe seu nome, e-mail e um horário.",
	invalidDetails: "Confira os e-mails dos convidados e as observações.",
	slotTaken: "Esse horário não está mais disponível.",
	eventNotFound: "Agendamento não encontrado",
};

export function calendarText(locale: string) {
	return locale.toLowerCase().startsWith("pt") ? portuguese : english;
}
