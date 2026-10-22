from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status


class RegisterViewTests(APITestCase):
    url = '/api/auth/register/'

    def test_successful_registration(self):
        payload = {
            'first_name': 'Jane',
            'last_name': 'Doe',
            'email': 'jane@example.com',
            'password': 'StrongPass1!',
            'confirm_password': 'StrongPass1!',
        }
        res = self.client.post(self.url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['email'], 'jane@example.com')
        # Password must not be in response
        self.assertNotIn('password', res.data)
        # User was created in the DB
        self.assertTrue(User.objects.filter(email='jane@example.com').exists())

    def test_password_mismatch(self):
        payload = {
            'first_name': 'Jane',
            'email': 'jane2@example.com',
            'password': 'StrongPass1!',
            'confirm_password': 'WrongPass99!',
        }
        res = self.client.post(self.url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('confirm_password', res.data)

    def test_duplicate_email(self):
        User.objects.create_user(username='dup@example.com', email='dup@example.com', password='Test1234!')
        payload = {
            'first_name': 'Dup',
            'email': 'dup@example.com',
            'password': 'StrongPass1!',
            'confirm_password': 'StrongPass1!',
        }
        res = self.client.post(self.url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', res.data)

    def test_missing_required_fields(self):
        res = self.client.post(self.url, {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_weak_password_rejected(self):
        payload = {
            'first_name': 'Jane',
            'email': 'jane3@example.com',
            'password': '123',
            'confirm_password': '123',
        }
        res = self.client.post(self.url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class LoginViewTests(APITestCase):
    url = '/api/auth/login/'

    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.com',
            email='test@example.com',
            password='StrongPass1!',
        )

    def test_successful_login(self):
        res = self.client.post(self.url, {'email': 'test@example.com', 'password': 'StrongPass1!'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['email'], 'test@example.com')

    def test_invalid_credentials(self):
        res = self.client.post(self.url, {'email': 'test@example.com', 'password': 'WrongPass!'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn('access', res.data)

    def test_missing_email(self):
        res = self.client.post(self.url, {'password': 'StrongPass1!'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_user_rejected(self):
        self.user.is_active = False
        self.user.save()
        res = self.client.post(self.url, {'email': 'test@example.com', 'password': 'StrongPass1!'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)


class MeViewTests(APITestCase):
    url = '/api/auth/me/'
    login_url = '/api/auth/login/'

    def setUp(self):
        self.user = User.objects.create_user(
            username='me@example.com',
            email='me@example.com',
            first_name='Me',
            password='StrongPass1!',
        )

    def _login(self):
        res = self.client.post(self.login_url, {'email': 'me@example.com', 'password': 'StrongPass1!'}, format='json')
        return res.data['access']

    def test_me_authenticated(self):
        token = self._login()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['email'], 'me@example.com')
        self.assertEqual(res.data['first_name'], 'Me')

    def test_me_unauthenticated(self):
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class LogoutViewTests(APITestCase):
    register_url = '/api/auth/register/'
    logout_url = '/api/auth/logout/'

    def test_logout_blacklists_refresh_token(self):
        # Register + get tokens
        payload = {
            'first_name': 'Logout',
            'email': 'logout@example.com',
            'password': 'StrongPass1!',
            'confirm_password': 'StrongPass1!',
        }
        reg = self.client.post(self.register_url, payload, format='json')
        access = reg.data['access']
        refresh = reg.data['refresh']

        # Logout
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        res = self.client.post(self.logout_url, {'refresh': refresh}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Attempting to use the blacklisted refresh token again should fail
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        res2 = self.client.post(self.logout_url, {'refresh': refresh}, format='json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
