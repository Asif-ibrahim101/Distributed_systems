const form = document.getElementById('moderate-form');
const waitingState = document.getElementById('waiting-state');
const setupInput = document.getElementById('setup');
const punchlineInput = document.getElementById('punchline');
const typeSelect = document.getElementById('type-select');
const newTypeToggle = document.getElementById('new-type-toggle');
const newTypeInput = document.getElementById('new-type-input');
const deliveryTagInput = document.getElementById('delivery-tag');
const rejectBtn = document.getElementById('reject-btn');
const feedback = document.getElementById('feedback');
const authStatusSpan = document.getElementById('auth-status');
const loginLink = document.getElementById('login-link');
const logoutLink = document.getElementById('logout-link');

let pollingInterval = null;

async function checkAuth() {
    try {
        const res = await fetch('/auth-status');
        const auth = await res.json();

        if (auth.isAuthenticated) {
            authStatusSpan.textContent = `Logged in as: ${auth.user.email || auth.user.name}`;
            logoutLink.classList.remove('hidden');
            loginLink.classList.add('hidden');
        } else {
            authStatusSpan.textContent = 'Not logged in';
            loginLink.classList.remove('hidden');
            logoutLink.classList.add('hidden');
            // Redirect unauthenticated users to Auth0 login
            window.location.href = '/login';
            return;
        }
    } catch (e) {
        console.error("Auth check failed", e);
    }
}

async function loadTypes() {
    try {
        const res = await fetch('/moderate-types');
        const types = await res.json();

        typeSelect.innerHTML = '';
        types.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeSelect.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load types:', err);
    }
}

async function pollForJoke() {
    try {
        const res = await fetch('/moderate');
        const data = await res.json();

        if (data.available && data.joke) {
            // Stop polling
            clearInterval(pollingInterval);
            pollingInterval = null;

            // Populate form
            setupInput.value = data.joke.setup;
            punchlineInput.value = data.joke.punchline;
            deliveryTagInput.value = data.deliveryTag;

            // Try to set correct type, or default to general
            if (Array.from(typeSelect.options).some(o => o.value === data.joke.type)) {
                typeSelect.value = data.joke.type;
                newTypeToggle.checked = false;
                newTypeInput.classList.add('hidden');
            } else {
                // Supplied type isn't in cache (maybe submitted as a new type originally)
                newTypeToggle.checked = true;
                newTypeInput.value = data.joke.type;
                newTypeInput.classList.remove('hidden');
                typeSelect.classList.add('hidden');
            }

            // Show form
            waitingState.classList.add('hidden');
            form.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
}

function startPolling() {
    form.classList.add('hidden');
    waitingState.classList.remove('hidden');

    // reset form inputs
    setupInput.value = '';
    punchlineInput.value = '';

    if (!pollingInterval) {
        pollForJoke(); // Check immediately
        pollingInterval = setInterval(pollForJoke, 1000);
    }
}

newTypeToggle.addEventListener('change', () => {
    if (newTypeToggle.checked) {
        typeSelect.classList.add('hidden');
        newTypeInput.classList.remove('hidden');
    } else {
        typeSelect.classList.remove('hidden');
        newTypeInput.classList.add('hidden');
    }
});

async function submitModeration(action) {
    const isNewType = newTypeToggle.checked;
    const type = isNewType ? newTypeInput.value.trim() : typeSelect.value;
    const setup = setupInput.value.trim();
    const punchline = punchlineInput.value.trim();
    const deliveryTag = deliveryTagInput.value;

    try {
        const res = await fetch('/moderated', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, setup, punchline, type, isNewType, deliveryTag })
        });

        if (res.ok) {
            // Success - immediately look for the next joke
            startPolling();
        } else {
            const data = await res.json();
            alert(`Error: ${data.error}`);
            // If unauthorized, trigger login check
            if (res.status === 401) checkAuth();
        }
    } catch (err) {
        console.error("Failed to submit moderation:", err);
        alert("Network error submitting moderation.");
    }
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitModeration('approve');
});

rejectBtn.addEventListener('click', () => {
    submitModeration('reject');
});

// Initialize
async function init() {
    await checkAuth();
    await loadTypes();
    startPolling();
}
init();
