// Smooth scrolling
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);
        
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
        }
    });
});

// Header scroll effect
const header = document.querySelector('header');
let lastScrollPosition = 0;

window.addEventListener('scroll', () => {
    const currentScrollPosition = window.pageYOffset;
    
    if (currentScrollPosition > 100) {
        header.classList.add('scrolled');
        
        if (currentScrollPosition < lastScrollPosition) {
            // Scrolling up
            header.style.transform = 'translateY(0)';
        } else {
            // Scrolling down
            header.style.transform = 'translateY(-100%)';
        }
    } else {
        header.classList.remove('scrolled');
        header.style.transform = 'translateY(0)';
    }
    
    lastScrollPosition = currentScrollPosition;
});

// Mobile menu
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');

menuBtn.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    
    if (navLinks.classList.contains('active')) {
        menuBtn.innerHTML = '<i class="fas fa-times"></i>';
    } else {
        menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
    }
});

// Service card animation with Intersection Observer
const serviceCards = document.querySelectorAll('.service-card');

const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

serviceCards.forEach((card, index) => {
    // Increase the delay between cards appearing
    card.style.transitionDelay = `${index * 0.15}s`;
    observer.observe(card);
});

// Clone marquee elements for infinite loop
const marquee = document.querySelector('.marquee');
const marqueeContent = marquee.innerHTML;
marquee.innerHTML = marqueeContent + marqueeContent;

// Add active class to current section in navigation
const sections = document.querySelectorAll('section');
const navItems = document.querySelectorAll('.nav-link');

window.addEventListener('scroll', () => {
    let current = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        
        if (pageYOffset >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });
    
    navItems.forEach(navItem => {
        navItem.classList.remove('active');
        if (navItem.getAttribute('href') === `#${current}`) {
            navItem.classList.add('active');
        }
    });
});

// Page load animations
window.addEventListener('load', () => {
    // Fade in hero content automatically without scroll
    const heroContent = document.querySelector('.hero-content');
    
    // Add a slight delay before showing the hero content to make the animation more noticeable
    setTimeout(() => {
        heroContent.classList.add('visible');
    }, 300);
    
    // Add page loaded class to body
    document.body.classList.add('loaded');
    
    // Add code animation lines
    createCodeAnimation();
});

// Generate code animation in the background
function createCodeAnimation() {
    const codeAnimation = document.getElementById('codeAnimation');
    if (!codeAnimation) return;
    
    const lines = 40; // Number of lines to create
    
    for (let i = 0; i < lines; i++) {
        const line = document.createElement('div');
        line.classList.add('code-line');
        
        // Randomize properties
        const duration = Math.random() * 3 + 2; // 2-5 seconds
        const delay = Math.random() * 5; // 0-5 seconds delay
        const posX = Math.random() * 100; // Random horizontal position
        const height = Math.random() * 30 + 10; // 10-40% height
        
        // Apply properties
        line.style.left = `${posX}%`;
        line.style.height = `${height}%`;
        line.style.animation = `code-rain ${duration}s ${delay}s linear infinite`;
        line.style.opacity = Math.random() * 0.5 + 0.1; // 0.1-0.6 opacity
        
        codeAnimation.appendChild(line);
    }
}

// Form validation (if you add a contact form later)
document.addEventListener('DOMContentLoaded', () => {
    const formElement = document.querySelector('form');
    
    if (formElement) {
        formElement.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Add your form validation and submission logic here
            
            // Example form validation
            const nameInput = document.getElementById('name');
            const emailInput = document.getElementById('email');
            const messageInput = document.getElementById('message');
            
            let isValid = true;
            
            if (nameInput && !nameInput.value.trim()) {
                isValid = false;
                nameInput.classList.add('error');
            } else if (nameInput) {
                nameInput.classList.remove('error');
            }
            
            if (emailInput && (!emailInput.value.trim() || !validateEmail(emailInput.value))) {
                isValid = false;
                emailInput.classList.add('error');
            } else if (emailInput) {
                emailInput.classList.remove('error');
            }
            
            if (messageInput && !messageInput.value.trim()) {
                isValid = false;
                messageInput.classList.add('error');
            } else if (messageInput) {
                messageInput.classList.remove('error');
            }
            
            if (isValid) {
                // Submit the form or show success message
                console.log('Form submitted successfully!');
                formElement.reset();
                
                // Show success message
                const successMessage = document.createElement('div');
                successMessage.classList.add('success-message');
                successMessage.textContent = 'Your message has been sent successfully!';
                formElement.appendChild(successMessage);
                
                setTimeout(() => {
                    successMessage.remove();
                }, 5000);
            }
        });
    }
});

// Email validation helper function
function validateEmail(email) {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}