from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError

from .serializers import RegisterSerializer, UserSerializer


def _get_tokens(user):
    """Return a dict with 'refresh' and 'access' JWT strings for user."""
    refresh = RefreshToken.for_user(user)
    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
    }


class RegisterView(APIView):
    """
    POST /api/auth/register/
    Register a new user account.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = serializer.save()
        tokens = _get_tokens(user)
        return Response(
            {
                'message': 'Account created successfully.',
                'user': UserSerializer(user).data,
                **tokens,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """
    POST /api/auth/login/
    Authenticate with email + password; return JWT tokens.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        password = request.data.get('password', '')

        if not email or not password:
            return Response(
                {'detail': 'Email and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if the account exists but is inactive BEFORE calling authenticate(),
        # because Django's authenticate() returns None for both inactive and wrong-password.
        try:
            db_user = User.objects.get(username=email)
            if not db_user.is_active:
                return Response(
                    {'detail': 'This account has been deactivated.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        except User.DoesNotExist:
            # No user with this email — fall through to the credential check below
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # At this point the user exists and is active; verify the password.
        user = authenticate(request, username=email, password=password)
        if user is None:
            return Response(
                {'detail': 'Invalid email or password.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        tokens = _get_tokens(user)
        return Response(
            {
                'message': 'Login successful.',
                'user': UserSerializer(user).data,
                **tokens,
            },

            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """
    POST /api/auth/logout/
    Blacklist the provided refresh token to invalidate the session.
    Requires Authorization: Bearer <access_token> header.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.data.get('refresh')
        if not refresh_token:
            return Response(
                {'detail': 'Refresh token is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError:
            return Response(
                {'detail': 'Token is invalid or already expired.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({'message': 'Logged out successfully.'}, status=status.HTTP_200_OK)


class MeView(APIView):
    """
    GET  /api/auth/me/  — Return the current authenticated user's profile.
    PATCH /api/auth/me/ — Update permitted profile fields (first_name, last_name).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data, status=status.HTTP_200_OK)

    def patch(self, request):
        """Allow updating first_name and last_name only."""
        user = request.user
        allowed_fields = {'first_name', 'last_name'}
        update_data = {k: v for k, v in request.data.items() if k in allowed_fields}

        errors = {}
        first_name = update_data.get('first_name', user.first_name)
        if 'first_name' in update_data and not first_name.strip():
            errors['first_name'] = 'First name is required.'

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        for field, value in update_data.items():
            setattr(user, field, value)
        user.save()
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """
    POST /api/auth/change-password/
    Change the authenticated user's password.

    Accepts:
        current_password  — the user's existing password (verified server-side)
        new_password      — the desired new password
        confirm_password  — must match new_password

    Returns new JWT tokens so the frontend can stay signed in after the change,
    without requiring the user to re-authenticate immediately.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        current_password = request.data.get('current_password', '')
        new_password = request.data.get('new_password', '')
        confirm_password = request.data.get('confirm_password', '')

        errors = {}

        if not current_password:
            errors['current_password'] = 'Current password is required.'
        elif not user.check_password(current_password):
            errors['current_password'] = 'Current password is incorrect.'

        if not new_password:
            errors['new_password'] = 'New password is required.'
        elif new_password == current_password:
            errors['new_password'] = 'New password must differ from the current password.'
        else:
            try:
                validate_password(new_password, user)
            except Exception as exc:
                errors['new_password'] = list(exc.messages)

        if not confirm_password:
            errors['confirm_password'] = 'Please confirm your new password.'
        elif new_password and new_password != confirm_password:
            errors['confirm_password'] = 'Passwords do not match.'

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Set the new password
        user.set_password(new_password)
        user.save()

        # Issue fresh tokens so the client does not lose its session.
        # The old refresh token will naturally expire; we do not blacklist it
        # here because the frontend will replace it immediately with the new pair.
        tokens = _get_tokens(user)
        return Response(
            {
                'message': 'Password changed successfully.',
                **tokens,
            },
            status=status.HTTP_200_OK,
        )
